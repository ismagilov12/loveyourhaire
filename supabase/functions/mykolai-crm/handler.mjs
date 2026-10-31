// A separate staff-only reader for Mykolai. No access to clothing or Teplo orders.
export const ORDER_STATUSES = ['new','confirmed','production','sent','done','cancelled'];
const STAFF_ROLES = new Set(['admin','manager','orders_manager']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGIN = 'https://loveyourhaire.vercel.app';
const selected = 'id,created_at,product_title,price,name,phone,city,branch,status,payment_method,payment_status,personalization,photo_paths';
function summary(row) {
  return Object.fromEntries(['id','created_at','product_title','price','name','phone','city','branch','status','payment_method','payment_status'].map(key=>[key,row[key]]));
}
export function createHandler({url,key,fetch:request=globalThis.fetch}) {
  return async function handler(req) {
    const origin=req.headers.get('origin');
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(origin===ALLOWED_ORIGIN)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'});
    const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
    if(origin&&origin!==ALLOWED_ORIGIN)return reply({error:'Недозволене джерело запиту.'},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return reply({error:'Потрібен POST-запит.'},405);
    if(!url||!key)return reply({error:'Розділ Миколайчик ще не підключено.'},503);
    const authorization=req.headers.get('authorization')||'';
    if(!/^Bearer \S+$/i.test(authorization))return reply({error:'Увійдіть до CRM.'},401);
    try {
      // Validate the real Auth user, never browser-supplied roles or user metadata.
      const userResponse=await request(url+'/auth/v1/user',{headers:{Authorization:authorization,apikey:key},signal:AbortSignal.timeout(10000)});
      if(!userResponse.ok)return reply({error:'Увійдіть до CRM повторно.'},401);
      const user=await userResponse.json();
      if(!UUID.test(user?.id||''))return reply({error:'Увійдіть до CRM.'},401);
      const serviceHeaders={Authorization:'Bearer '+key,apikey:key,'Content-Type':'application/json'};
      async function db(path,options={}) {
        const result=await request(url+path,{...options,headers:{...serviceHeaders,...options.headers},signal:AbortSignal.timeout(12000)});
        if(!result.ok)throw Error('database');
        return {data:await result.json(),headers:result.headers};
      }
      const access=await db('/rest/v1/crm_access?user_id=eq.'+user.id+'&select=role,active');
      if(!access.data?.some(row=>row.active===true&&STAFF_ROLES.has(row.role)))return reply({error:'Немає доступу до CRM.'},403);
      const raw=await req.text();
      if(raw.length>4000)return reply({error:'Запит завеликий.'},413);
      let body;try{body=JSON.parse(raw);}catch{return reply({error:'Некоректний запит.'},400);}
      if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Некоректний запит.'},400);
      if(body.action==='list') {
        const offset=body.offset??0,filter=body.status??'all';
        if(!Number.isInteger(offset)||offset<0||offset>100000||!['all',...ORDER_STATUSES].includes(filter))return reply({error:'Некоректний фільтр.'},400);
        const result=await db('/rest/v1/mykolai_orders?select='+selected+'&order=created_at.desc,id.desc&limit=25&offset='+offset+(filter==='all'?'':'&status=eq.'+filter),{headers:{Prefer:'count=exact'}});
        const total=Number((result.headers.get('content-range')||'').split('/')[1]);
        return reply({rows:result.data.map(summary),total:Number.isFinite(total)?total:offset+result.data.length,offset});
      }
      if(!['detail','status'].includes(body.action)||!UUID.test(body.order_id||''))return reply({error:'Некоректне замовлення.'},400);
      const result=await db('/rest/v1/mykolai_orders?id=eq.'+body.order_id+'&select='+selected);
      const row=result.data[0];
      if(!row)return reply({error:'Замовлення не знайдено.'},404);
      if(body.action==='status') {
        if(!ORDER_STATUSES.includes(body.status)||!ORDER_STATUSES.includes(body.previous_status))return reply({error:'Невідомий статус.'},400);
        if(['production','sent','done'].includes(body.status)&&row.payment_method==='online'&&row.payment_status!=='paid')return reply({error:'Спочатку дочекайтеся підтвердження онлайн-оплати.'},409);
        const changed=await db('/rest/v1/mykolai_orders?id=eq.'+row.id+'&status=eq.'+body.previous_status,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:body.status})});
        if(changed.data.length!==1)return reply({error:'Статус уже змінено. Оновіть замовлення.'},409);
        return reply({ok:true,row:summary(changed.data[0])});
      }
      const source=row.personalization||{};
      const paths=Array.isArray(row.photo_paths)?row.photo_paths:[];
      const allowed=new Set(paths.filter(path=>typeof path==='string'&&path.startsWith(row.id+'/')&&UUID.test(path.split('/')[0])&&/^photo-\d+\.jpg$/.test(path.split('/')[1])&&path.split('/').length===2));
      const media={};
      await Promise.all([...allowed].slice(0,30).map(async path=>{
        const signed=await db('/storage/v1/object/sign/mykolai-orders/'+path,{method:'POST',body:JSON.stringify({expiresIn:300})});
        const value=signed.data.signedURL||signed.data.signedUrl;
        if(typeof value==='string') {
          const destination=value.startsWith('http')?new URL(value):new URL('/storage/v1'+value,url);
          if(destination.origin===new URL(url).origin)media[path]=destination.href;
        }
      }));
      const fieldKeys=['child_name','names','recipient','mug_color','message','revision_note','date'];
      const fields=value=>Object.fromEntries(fieldKeys.filter(key=>typeof value?.[key]==='string').map(key=>[key,value[key]]));
      const items=Array.isArray(source.items)?source.items.slice(0,10).map(item=>({product_title:item.product_title,quantity:item.quantity,unit_price:item.unit_price,personalization:fields(item.personalization),source_paths:(item.source_paths||[]).filter(path=>allowed.has(path)),mockup_path:allowed.has(item.mockup_path)?item.mockup_path:null})):[{product_title:row.product_title,quantity:1,personalization:fields(source),source_paths:[...allowed],mockup_path:null}];
      return reply({row:summary(row),items,order_comment:typeof source.order_comment==='string'?source.order_comment:'',media});
    } catch {
      // Never return provider bodies, tokens or private database errors to the browser.
      return reply({error:'Не вдалося завантажити Миколайчик. Спробуйте ще раз.'},503);
    }
  };
}

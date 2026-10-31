(function(){
 'use strict';
 const h=React.createElement;
 const labels={new:'Нові',confirmed:'Підтверджені',production:'У виробництві',sent:'Відправлені',done:'Завершені',cancelled:'Скасовані'};
 const money=value=>Number(value||0).toLocaleString('uk-UA')+' грн';
 const number=id=>'№'+String(id).replace(/\D/g,'').slice(-3).padStart(3,'0');
 async function call(client,apiURL,apiKey,body,signal){
   const session=await client.auth.getSession();
   if(session.error||!session.data?.session?.access_token)throw Error('Увійдіть до CRM повторно.');
   const response=await fetch(apiURL+'/functions/v1/mykolai-crm',{method:'POST',headers:{Authorization:'Bearer '+session.data.session.access_token,apikey:apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
   let data;try{data=await response.json();}catch{throw Error('Не вдалося прочитати відповідь Миколайчика.');}
   if(!response.ok)throw Error(data.error||'Миколайчик ще не підключено до CRM.');
   return data;
 }
 function MykolaiOrders({client,apiURL,apiKey}){
   const[filter,setFilter]=React.useState('all'),[offset,setOffset]=React.useState(0),[data,setData]=React.useState(null),[loading,setLoading]=React.useState(false),[error,setError]=React.useState(''),[reload,setReload]=React.useState(0),[updated,setUpdated]=React.useState(null),[selected,setSelected]=React.useState(null),[detail,setDetail]=React.useState(null),[detailError,setDetailError]=React.useState(''),[saving,setSaving]=React.useState(false);
   React.useEffect(()=>{
     let alive=true,active=false;const controller=new AbortController();
     async function load(){if(active||document.visibilityState==='hidden')return;active=true;setLoading(true);
       try{const result=await call(client,apiURL,apiKey,{action:'list',status:filter,offset},controller.signal);if(alive){setData(result);setError('');setUpdated(new Date());}}
       catch(e){if(alive&&e.name!=='AbortError')setError(e.message);}
       finally{active=false;if(alive)setLoading(false);}
     }
     load();const timer=setInterval(load,30000);document.addEventListener('visibilitychange',load);
     return()=>{alive=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
   },[client,apiURL,apiKey,filter,offset,reload]);
   React.useEffect(()=>{
     if(!selected)return;let alive=true;const controller=new AbortController();setDetail(null);setDetailError('');
     call(client,apiURL,apiKey,{action:'detail',order_id:selected},controller.signal).then(result=>{if(alive)setDetail(result);}).catch(e=>{if(alive&&e.name!=='AbortError')setDetailError(e.message);});
     return()=>{alive=false;controller.abort();};
   },[client,apiURL,apiKey,selected]);
   async function status(value){if(saving||!detail)return;setSaving(true);setDetailError('');
     try{const result=await call(client,apiURL,apiKey,{action:'status',order_id:detail.row.id,previous_status:detail.row.status,status:value});setDetail(current=>({...current,row:result.row}));setReload(x=>x+1);}
     catch(e){setDetailError(e.message);}finally{setSaving(false);}
   }
   const photo=(path,label)=>detail.media?.[path]?h('a',{key:path,href:detail.media[path],target:'_blank',rel:'noopener noreferrer'},h('img',{src:detail.media[path],alt:label,referrerPolicy:'no-referrer',style:{width:145,height:130,objectFit:'contain',borderRadius:8,background:'#fff'}})):null;
   return h('section',{'aria-label':'Замовлення Миколайчик'},
     h('div',{style:{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:14}},h('div',null,h('h2',null,'Миколайчик'),h('p',{style:{fontSize:12,marginTop:6}},'Замовлення з mykolai-teplo.vercel.app · оновлення кожні 30 секунд')),h('button',{className:'btn btn-secondary',disabled:loading,onClick:()=>setReload(x=>x+1)},loading?'Оновлюємо…':'Оновити Миколайчик')),
     h('div',{style:{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}},Object.entries({all:'Усі',...labels}).map(([id,label])=>h('button',{key:id,className:'filter-pill'+(filter===id?' active':''),onClick:()=>{setFilter(id);setOffset(0);setData(null);}},label))),
     error&&h('p',{role:'alert',style:{padding:12,color:'#b91c1c',background:'#fef2f2'}},error),
     !data&&loading&&h('p',{role:'status'},'Завантажуємо замовлення Миколайчик…'),
     data&&h(React.Fragment,null,
       h('p',{style:{fontSize:12,marginBottom:12}},'Замовлень: '+data.total+(updated?' · Оновлено '+updated.toLocaleTimeString('uk-UA'):'')),
       !data.rows.length?h('div',{className:'card'},'У цьому фільтрі замовлень поки немає.'):h('div',{style:{display:'grid',gap:12}},data.rows.map(row=>h('article',{key:row.id,className:'card',style:{padding:16}},
         h('div',{style:{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}},h('strong',null,number(row.id)+' · '+row.name),h('span',{className:'badge badge-pink'},labels[row.status]||row.status)),
         h('p',null,row.product_title),h('p',null,row.city+' · '+row.branch),h('p',null,row.phone+' · '+money(row.price)),
         h('p',{style:{fontSize:12}},row.payment_method==='online'?(row.payment_status==='paid'?'Оплачено онлайн':'Онлайн-оплата: '+row.payment_status):'Оплата при отриманні'),
         h('button',{className:'btn btn-secondary btn-sm',onClick:()=>setSelected(row.id)},'Відкрити замовлення і макет')
       ))),
       h('div',{style:{display:'flex',justifyContent:'space-between',marginTop:16}},h('button',{className:'btn btn-secondary',disabled:loading||offset===0,onClick:()=>{setOffset(x=>Math.max(0,x-25));setData(null);}},'← Попередні'),h('button',{className:'btn btn-secondary',disabled:loading||offset+25>=data.total,onClick:()=>{setOffset(x=>x+25);setData(null);}},'Наступні →'))),
     selected&&h('div',{className:'modal-overlay'},h('section',{className:'modal',role:'dialog','aria-modal':'true','aria-label':'Деталі замовлення Миколайчик'},
       h('button',{className:'btn btn-secondary',disabled:saving,onClick:()=>{setSelected(null);setDetail(null);}},'Закрити ×'),
       detailError&&h('p',{role:'alert',style:{color:'#b91c1c',marginTop:12}},detailError),
       !detail&&!detailError&&h('p',{role:'status'},'Відкриваємо замовлення…'),
       detail&&h(React.Fragment,null,
         h('h2',{style:{marginTop:14}},'Миколайчик '+number(detail.row.id)),h('p',null,detail.row.name+' · '+detail.row.phone),h('p',null,detail.row.city+' · '+detail.row.branch),h('p',null,money(detail.row.price)),
         h('label',null,'Статус замовлення ',h('select',{className:'form-input',value:detail.row.status,disabled:saving,onChange:e=>status(e.target.value)},Object.entries(labels).map(([id,label])=>h('option',{key:id,value:id},label)))),
         detail.order_comment&&h('p',{style:{whiteSpace:'pre-wrap'}},'Коментар: '+detail.order_comment),
         detail.items.map((item,index)=>h('div',{key:index,style:{borderTop:'1px solid #eee',paddingTop:12,marginTop:12}},h('strong',null,item.product_title+' × '+item.quantity),
           Object.entries({child_name:'Ім’я дитини',recipient:'Ким є дитина',mug_color:'Деталі чашки',message:'Напис',revision_note:'Побажання'}).map(([key,label])=>item.personalization?.[key]?h('p',{key,style:{whiteSpace:'pre-wrap'}},label+': '+(key==='mug_color'?({red:'червоні',blue:'сині'}[item.personalization[key]]||item.personalization[key]):item.personalization[key])):null),
           h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},(item.source_paths||[]).map(path=>photo(path,'Фото дитини')),item.mockup_path&&photo(item.mockup_path,'Обраний макет')))),
         h('small',null,'Посилання на фото діють 5 хвилин. Для оновлення закрийте та відкрийте замовлення.'))))
   );
 }
 window.MykolaiOrders=MykolaiOrders;
}());

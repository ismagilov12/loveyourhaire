import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHandler} from '../supabase/functions/mykolai-crm/handler.mjs';
const orderId='8bd14972-13d3-4784-bd62-5d4a1f9603dc',userId='12345678-1234-4234-8234-123456789012';
function setup({role='admin',active=true,valid=true,payment='cod',paid='unpaid',changed=true}={}){
 const calls=[],row={id:orderId,created_at:'2026-10-31T00:00:00Z',name:'Тест',price:349,status:'new',payment_method:payment,payment_status:paid,personalization:{_request_fingerprint:'private',items:[{product_title:'Чашка',quantity:1,personalization:{child_name:'Марко',recipient:'Онук',mug_color:'blue'},source_paths:[orderId+'/photo-1.jpg','../other/photo-1.jpg'],mockup_path:orderId+'/photo-2.jpg'}]},photo_paths:[orderId+'/photo-1.jpg',orderId+'/photo-2.jpg','../secret.jpg']};
 const handler=createHandler({url:'https://example.supabase.co',key:'service-key',fetch:async(url,opts={})=>{
   calls.push({url,opts});let body;
   if(url.endsWith('/auth/v1/user'))return Response.json(valid?{id:userId}:{},{status:valid?200:401});
   if(url.includes('/crm_access?'))body=[{role,active}];
   else if(url.includes('/mykolai_orders?'))body=opts.method==='PATCH'?(changed?[{...row,status:JSON.parse(opts.body).status}]:[]):[row];
   else if(url.includes('/storage/v1/object/sign/mykolai-orders/'))body={signedURL:'/object/sign/mykolai-orders/'+orderId+'/photo-1.jpg?token=test'};
   else throw Error('Unexpected request '+url);
   return Response.json(body,{headers:{'content-range':'0-0/1'}});
 }});
 return {calls,async call(body,headers={}){const response=await handler(new Request('https://edge.test',{method:'POST',headers:{authorization:'Bearer user-token',origin:'https://loveyourhaire.vercel.app',...headers},body:JSON.stringify(body)}));return {status:response.status,data:await response.json()};}};
}
test('invalid sessions and inactive, unknown or disabled staff never read orders',async()=>{
 for(const options of [{valid:false},{active:false},{role:'disabled'},{role:'customer'}]){const s=setup(options);assert.ok([401,403].includes((await s.call({action:'list'})).status));assert.ok(s.calls.every(c=>!c.url.includes('mykolai_orders')));}
});
test('foreign origins cannot access the protected function',async()=>{const s=setup();assert.equal((await s.call({action:'list'},{origin:'https://other.test'})).status,403);assert.equal(s.calls.length,0);});
test('lists read Mykolai only and exclude private source fields',async()=>{const s=setup();const r=await s.call({action:'list',status:'new',offset:25});assert.equal(r.status,200);assert.equal(r.data.total,1);assert.equal(r.data.rows[0].price,349);assert.ok(!('personalization' in r.data.rows[0]));assert.match(s.calls.at(-1).url,/offset=25&status=eq.new/);assert.ok(s.calls.every(c=>!c.url.includes('teplo_orders')&&!c.url.includes('cups_orders')&&!c.url.includes('babygirl')));});
test('invalid filters and order IDs cannot become database queries',async()=>{for(const b of [{action:'list',status:'new&select=*'},{action:'list',offset:-1},{action:'detail',order_id:'../other'}]){const s=setup();assert.equal((await s.call(b)).status,400);assert.ok(s.calls.every(c=>!c.url.includes('mykolai_orders')));}});
test('details retain child data and sign only this order’s private media for 300 seconds',async()=>{const s=setup();const r=await s.call({action:'detail',order_id:orderId});assert.equal(r.status,200);assert.equal(r.data.items[0].personalization.recipient,'Онук');assert.equal(r.data.items[0].personalization.mug_color,'blue');assert.equal(r.data.items[0].source_paths.length,1);assert.equal(Object.keys(r.data.media).length,2);assert.ok(!JSON.stringify(r.data).includes('_request_fingerprint'));for(const c of s.calls.filter(c=>c.url.includes('/storage/'))){assert.match(c.url,/mykolai-orders\/8bd14972/);assert.deepEqual(JSON.parse(c.opts.body),{expiresIn:300});}});
test('status writes affect one Mykolai row with optimistic concurrency and cannot change payment',async()=>{const s=setup();const r=await s.call({action:'status',order_id:orderId,previous_status:'new',status:'confirmed',payment_status:'paid',price:1});assert.equal(r.status,200);const patch=s.calls.find(c=>c.opts.method==='PATCH');assert.match(patch.url,/mykolai_orders\?id=eq.*&status=eq.new/);assert.deepEqual(JSON.parse(patch.opts.body),{status:'confirmed'});const stale=setup({changed:false});assert.equal((await stale.call({action:'status',order_id:orderId,previous_status:'new',status:'confirmed'})).status,409);});
test('pending online payment cannot enter production or shipment',async()=>{for(const status of ['production','sent','done']){const s=setup({payment:'online'});assert.equal((await s.call({action:'status',order_id:orderId,previous_status:'new',status})).status,409);assert.ok(!s.calls.some(c=>c.opts.method==='PATCH'));}});
test('CRM modification is limited to a script, navigation item and independent render branch',()=>{const old=readFileSync(new URL('./fixtures/cups-before.html',import.meta.url),'utf8'),next=readFileSync(new URL('../cups.html',import.meta.url),'utf8');const restored=next.replace('\n<script src="./mykolai-crm.js?v=20261031"></script>','').replace('{id:"mykolai",label:"Миколайчик",icon:I.bag},','').replace('currentPage==="mykolai"?<window.MykolaiOrders client={crmSupabase} apiURL={SUPABASE_URL} apiKey={SUPABASE_KEY}/>:','');assert.equal(restored,old);});

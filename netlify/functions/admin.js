const { createClient }=require('@supabase/supabase-js');
const out=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return out(405,{error:'Method not allowed'});
 try{
  const token=(event.headers.authorization||'').replace('Bearer ','');
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:{user},error}=await supabase.auth.getUser(token);
  if(error||!user)return out(401,{error:'Login required'});
  const admins=(process.env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!admins.includes((user.email||'').toLowerCase()))return out(403,{error:'Admin access required'});
  const body=JSON.parse(event.body||'{}'), action=body.action;
  if(action==='product.create'){
   const p=body.product||{}; if(!p.name||!p.slug||!Number(p.price))return out(400,{error:'Name, slug and price required'});
   const {data,error:e}=await supabase.from('products').insert({name:p.name,slug:p.slug,description:p.description||'',price:Number(p.price),compare_price:Number(p.compare_price||p.price),compatibility:p.compatibility||'',file_size:p.file_size||'',active:p.active!==false,lifetime_updates:p.lifetime_updates!==false}).select().single();
   if(e)return out(400,{error:e.message}); return out(200,{product:data});
  }
  if(action==='product.toggle'){
   const {error:e}=await supabase.from('products').update({active:!!body.active}).eq('id',body.id);if(e)return out(400,{error:e.message});return out(200,{ok:true});
  }
  if(action==='product.update'){
   const p=body.product||{}; if(!body.id)return out(400,{error:'Product id required'});
   const patch={}; ['name','slug','description','compatibility','file_size'].forEach(k=>{if(p[k]!==undefined)patch[k]=p[k]});
   if(p.price!==undefined)patch.price=Number(p.price); if(p.compare_price!==undefined)patch.compare_price=Number(p.compare_price);
   const {data,error:e}=await supabase.from('products').update(patch).eq('id',body.id).select().single();if(e)return out(400,{error:e.message});return out(200,{product:data});
  }
  if(action==='file.list'){
   const {data,error:e}=await supabase.from('product_files').select('id,product_id,version,storage_path,is_current,created_at').eq('product_id',body.productId).order('created_at',{ascending:false});if(e)return out(400,{error:e.message});return out(200,{files:data});
  }
  if(action==='file.link'){
   if(!body.productId||!body.storagePath)return out(400,{error:'Product and storage path required'});
   await supabase.from('product_files').update({is_current:false}).eq('product_id',body.productId);
   const {data,error:e}=await supabase.from('product_files').insert({product_id:body.productId,version:body.version||'1.0',storage_path:body.storagePath,is_current:true}).select().single();if(e)return out(400,{error:e.message});return out(200,{file:data});
  }
  if(action==='setting.save'){
   if(!body.key)return out(400,{error:'Setting key required'});
   const {data,error:e}=await supabase.from('store_settings').upsert({key:body.key,value:String(body.value??'')},{onConflict:'key'}).select().single();
   if(e)return out(400,{error:e.message});return out(200,{setting:data});
  }
  if(action==='analytics.summary'){
   const [p,o,d]=await Promise.all([
    supabase.from('products').select('id',{count:'exact',head:true}),
    supabase.from('purchases').select('id',{count:'exact',head:true}),
    supabase.from('download_events').select('id',{count:'exact',head:true})
   ]);
   return out(200,{products:p.count||0,orders:o.count||0,downloads:d.count||0});
  }
  if(action==='orders.list'){
   const {data,error:e}=await supabase.from('purchases').select('*').order('created_at',{ascending:false}).limit(100);if(e)return out(400,{error:e.message});return out(200,{orders:data});
  }
  return out(400,{error:'Unknown action'});
 }catch(e){return out(500,{error:'Admin operation failed'})}
};
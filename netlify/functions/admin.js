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
  if(action==='setup.ensure'){
   const buckets=await supabase.storage.listBuckets();if(buckets.error)return out(400,{error:buckets.error.message});
   if(!(buckets.data||[]).some(b=>b.name==='store-assets')){const cr=await supabase.storage.createBucket('store-assets',{public:true,fileSizeLimit:8388608,allowedMimeTypes:['image/jpeg','image/png','image/webp','image/gif']});if(cr.error)return out(400,{error:cr.error.message})}
   return out(200,{ok:true,storeAssets:true});
  }
  if(action==='asset.upload'){
   const folder=String(body.folder||'').trim();if(!['banners','thumbnails'].includes(folder))return out(400,{error:'Unsupported asset folder'});
   const fileName=String(body.fileName||'').trim().replace(/[^A-Za-z0-9._ -]/g,'-');const mime=String(body.mimeType||'').toLowerCase();
   if(!fileName||!['image/jpeg','image/png','image/webp','image/gif'].includes(mime))return out(400,{error:'PNG, JPG, WEBP or GIF image required'});
   let bytes;try{bytes=Buffer.from(String(body.base64||''),'base64')}catch(e){return out(400,{error:'Invalid image data'})}
   if(!bytes.length||bytes.length>8*1024*1024)return out(400,{error:'Image must be under 8 MB'});
   const ext=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif' })[mime],stem=fileName.replace(/\.[^.]+$/,'').slice(0,90)||'image',path=folder+'/'+Date.now()+'-'+stem+'.'+ext;
   const {error:e}=await supabase.storage.from('site-assets').upload(path,bytes,{contentType:mime,upsert:false,cacheControl:'3600'});if(e)return out(400,{error:e.message});
   const {data:pub}=supabase.storage.from('site-assets').getPublicUrl(path);return out(200,{path,url:pub.publicUrl});
  }
  if(action==='product.create'){
   const p=body.product||{}; if(!p.name||!p.slug||!Number(p.price)||!p.category_id)return out(400,{error:'Name, slug, price and category required'});if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(p.slug)))return out(400,{error:'Slug must use lowercase letters, numbers and hyphens only'}); const price=Number(p.price),compare=Number(p.compare_price||p.price); if(!Number.isFinite(price)||price<=0)return out(400,{error:'Price must be greater than zero'}); if(!Number.isFinite(compare)||compare<price)return out(400,{error:'Compare price cannot be lower than price'});
   const {data:cat,error:catErr}=await supabase.from('categories').select('id').eq('id',p.category_id).maybeSingle();if(catErr||!cat)return out(400,{error:'Select a valid category'}); const {data,error:e}=await supabase.from('products').insert({name:p.name,slug:p.slug,description:p.description||'',price,compare_price:compare,compatibility:p.compatibility||'',file_size:p.file_size||'',category_id:p.category_id,active:p.active!==false,lifetime_updates:p.lifetime_updates!==false}).select().single();
   if(e)return out(400,{error:e.message}); return out(200,{product:data});
  }
  if(action==='product.delete'){
   if(!body.id)return out(400,{error:'Product id required'});const owned=await supabase.from('purchases').select('id',{count:'exact',head:true}).eq('product_id',body.id);if(owned.error)return out(400,{error:owned.error.message});if((owned.count||0)>0)return out(409,{error:'Purchased products cannot be deleted. Hide the product instead.'});await supabase.from('product_files').delete().eq('product_id',body.id);const {error:e}=await supabase.from('products').delete().eq('id',body.id);if(e)return out(400,{error:e.message});return out(200,{ok:true});
  }
  if(action==='category.list'){const {data,error:e}=await supabase.from('categories').select('id,name,slug').order('name');if(e)return out(400,{error:e.message});return out(200,{categories:data||[]})}
  if(action==='category.save'){const name=String(body.name||'').trim(),slug=String(body.slug||'').trim().toLowerCase();if(!name||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return out(400,{error:'Valid category name and slug required'});const {data,error:e}=await supabase.from('categories').upsert({name,slug},{onConflict:'slug'}).select().single();if(e)return out(400,{error:e.message});return out(200,{category:data})}
  if(action==='category.delete'){if(!body.id)return out(400,{error:'Category id required'});const used=await supabase.from('products').select('id',{count:'exact',head:true}).eq('category_id',body.id);if(!used.error&&(used.count||0)>0)return out(409,{error:'Move or remove products from this category first'});const {error:e}=await supabase.from('categories').delete().eq('id',body.id);if(e)return out(400,{error:e.message});return out(200,{ok:true})}
  if(action==='product.toggle'){
   const {error:e}=await supabase.from('products').update({active:!!body.active}).eq('id',body.id);if(e)return out(400,{error:e.message});return out(200,{ok:true});
  }
  if(action==='product.update'){
   const p=body.product||{}; if(!body.id)return out(400,{error:'Product id required'});
   const {data:current,error:ce}=await supabase.from('products').select('price,compare_price').eq('id',body.id).maybeSingle();if(ce)return out(400,{error:ce.message});if(!current)return out(404,{error:'Product not found'});
   const patch={}; ['name','slug','description','compatibility','file_size','thumbnail_path'].forEach(k=>{if(p[k]!==undefined)patch[k]=String(p[k]).trim()});if(p.category_id!==undefined){const cid=String(p.category_id).trim();if(!cid)return out(400,{error:'Category cannot be empty'});const {data:cat,error:catErr}=await supabase.from('categories').select('id').eq('id',cid).maybeSingle();if(catErr||!cat)return out(400,{error:'Select a valid category'});patch.category_id=cid}if(p.slug!==undefined&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(patch.slug))return out(400,{error:'Slug must use lowercase letters, numbers and hyphens only'});if(p.name!==undefined&&!patch.name)return out(400,{error:'Product name cannot be empty'});
   if(p.price!==undefined){patch.price=Number(p.price);if(!Number.isFinite(patch.price)||patch.price<=0)return out(400,{error:'Price must be greater than zero'})} if(p.compare_price!==undefined){patch.compare_price=Number(p.compare_price);if(!Number.isFinite(patch.compare_price)||patch.compare_price<=0)return out(400,{error:'Compare price must be greater than zero'})}
   const finalPrice=patch.price!==undefined?patch.price:Number(current.price),finalCompare=patch.compare_price!==undefined?patch.compare_price:Number(current.compare_price||current.price);if(finalCompare<finalPrice)return out(400,{error:'Compare price cannot be lower than price'});
   const {data,error:e}=await supabase.from('products').update(patch).eq('id',body.id).select().single();if(e)return out(400,{error:e.message});return out(200,{product:data});
  }
  if(action==='file.list'){
   const {data,error:e}=await supabase.from('product_files').select('id,product_id,version,storage_path,is_current,created_at').eq('product_id',body.productId).order('created_at',{ascending:false});if(e)return out(400,{error:e.message});return out(200,{files:data});
  }
  if(action==='file.link'){
   if(!body.productId||!body.storagePath)return out(400,{error:'Product and Google Drive File ID required'});
   const fileId=String(body.storagePath).trim();
   if(!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))return out(400,{error:'Enter a valid Google Drive File ID'});
   const row={product_id:body.productId,version:String(body.version||'1.0').trim().slice(0,50),storage_path:fileId,is_current:false};
   const {data:newFile,error:insertError}=await supabase.from('product_files').insert(row).select().single();
   if(insertError)return out(400,{error:insertError.message});
   const {error:clearError}=await supabase.from('product_files').update({is_current:false}).eq('product_id',body.productId).neq('id',newFile.id);
   if(clearError){await supabase.from('product_files').delete().eq('id',newFile.id);return out(400,{error:'Could not switch current product file'});}
   const {data,error:e}=await supabase.from('product_files').update({is_current:true}).eq('id',newFile.id).select().single();
   if(e)return out(400,{error:e.message});return out(200,{file:data});
  }
  if(action==='setting.save'){
   const allowedSettings=new Set(['offer_bar','hero_banners']);if(!allowedSettings.has(String(body.key||'')))return out(400,{error:'Unsupported store setting'});
   const {data,error:e}=await supabase.from('store_settings').upsert({key:body.key,value:String(body.value??'')},{onConflict:'key'}).select().single();
   if(e)return out(400,{error:e.message});return out(200,{setting:data});
  }
  if(action==='grant.access'){
   if(!body.email||!body.productId)return out(400,{error:'Email and product required'});
   const {data:users,error:ue}=await supabase.auth.admin.listUsers({page:1,perPage:1000});if(ue)return out(400,{error:ue.message});
   const target=(users.users||[]).find(u=>(u.email||'').toLowerCase()===String(body.email).trim().toLowerCase());if(!target)return out(404,{error:'No account found for this email'});
   const {data:existing,error:xe}=await supabase.from('purchases').select('id').eq('user_id',target.id).eq('product_id',body.productId).maybeSingle();if(xe)return out(400,{error:xe.message});if(existing)return out(200,{purchase:existing,alreadyGranted:true});
   const {data,error:e}=await supabase.from('purchases').insert({user_id:target.id,product_id:body.productId}).select().single();
   if(e)return out(400,{error:e.message});return out(200,{purchase:data});
  }
  if(action==='coupon.validate'){
   const code=String(body.code||'').trim().toUpperCase();if(!code)return out(400,{error:'Coupon code required'});
   const {data,error:e}=await supabase.from('coupons').select('code,discount_type,value,active,expires_at').eq('code',code).maybeSingle();
   if(e)return out(400,{error:e.message});if(!data||!data.active)return out(404,{error:'Invalid or inactive coupon'});if(data.expires_at&&new Date(data.expires_at).getTime()<=Date.now())return out(410,{error:'Coupon has expired'});if(data.discount_type==='percent'&&(Number(data.value)<=0||Number(data.value)>100))return out(400,{error:'Coupon configuration is invalid'});if(data.discount_type==='fixed'&&Number(data.value)<=0)return out(400,{error:'Coupon configuration is invalid'});
   return out(200,{coupon:data});
  }
  if(action==='coupon.list'){
   const {data,error:e}=await supabase.from('coupons').select('*').order('created_at',{ascending:false});if(e)return out(400,{error:e.message});return out(200,{coupons:data});
  }
  if(action==='coupon.save'){
   const c=body.coupon||{};if(!c.code||!Number(c.value))return out(400,{error:'Coupon code and value required'});
   const type=c.discount_type==='fixed'?'fixed':'percent',val=Number(c.value);if(type==='percent'&&(val<=0||val>100))return out(400,{error:'Percent discount must be between 1 and 100'});if(type==='fixed'&&val<=0)return out(400,{error:'Fixed discount must be greater than zero'});const row={code:String(c.code).trim().toUpperCase(),discount_type:type,value:val,active:c.active!==false,expires_at:c.expires_at||null};
   const {data,error:e}=await supabase.from('coupons').upsert(row,{onConflict:'code'}).select().single();if(e)return out(400,{error:e.message});return out(200,{coupon:data});
  }
  if(action==='analytics.summary'){
   const [p,o,d]=await Promise.all([
    supabase.from('products').select('id',{count:'exact',head:true}),
    supabase.from('purchases').select('id',{count:'exact',head:true}),
    supabase.from('download_events').select('id',{count:'exact',head:true})
   ]);
   return out(200,{products:p.count||0,orders:o.count||0,downloads:d.count||0});
  }
  if(action==='customers.list'){
   const {data:orders,error:e}=await supabase.from('purchases').select('user_id,granted_at');if(e)return out(400,{error:e.message});
   const {data:users,error:ue}=await supabase.auth.admin.listUsers({page:1,perPage:1000});if(ue)return out(400,{error:ue.message});
   const byUser={};
   for(const o of orders||[]){if(!byUser[o.user_id])byUser[o.user_id]={orders:0,last_purchase:null};byUser[o.user_id].orders++;if(!byUser[o.user_id].last_purchase||o.granted_at>byUser[o.user_id].last_purchase)byUser[o.user_id].last_purchase=o.granted_at}
   const customers=Object.keys(byUser).map(id=>{const u=(users.users||[]).find(v=>v.id===id);return{id,email:u&&u.email?u.email:'Unknown',orders:byUser[id].orders,last_purchase:byUser[id].last_purchase}});
   return out(200,{customers});
  }
  if(action==='orders.list'){
   const {data,error:e}=await supabase.from('purchases').select('id,user_id,product_id,granted_at,products(name)').order('granted_at',{ascending:false}).limit(100);if(e)return out(400,{error:e.message});
   const {data:users,error:ue}=await supabase.auth.admin.listUsers({page:1,perPage:1000});if(ue)return out(400,{error:ue.message});const emails=new Map((users.users||[]).map(u=>[u.id,u.email||'Unknown']));
   return out(200,{orders:(data||[]).map(o=>({...o,product_name:o.products?.name||o.product_id,user_email:emails.get(o.user_id)||'Unknown'}))});
  }
  return out(400,{error:'Unknown action'});
 }catch(e){return out(500,{error:'Admin operation failed'})}
};
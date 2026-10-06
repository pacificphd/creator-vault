const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const out=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const b64url=v=>Buffer.from(v).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
async function googleAccessToken(){
 const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
 const rawKey=process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
 if(!email||!rawKey)throw new Error('Google Drive credentials are not configured');
 const key=rawKey.replace(/\\n/g,'\n');
 const now=Math.floor(Date.now()/1000);
 const header=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
 const claim=b64url(JSON.stringify({iss:email,scope:'https://www.googleapis.com/auth/drive',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
 const signer=crypto.createSign('RSA-SHA256');signer.update(header+'.'+claim);signer.end();
 const assertion=header+'.'+claim+'.'+signer.sign(key,'base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion});
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
 const j=await r.json();if(!r.ok||!j.access_token)throw new Error('Could not authenticate Google Drive');return j.access_token;
}
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return out(405,{error:'Method not allowed'});
 try{
  const token=(event.headers.authorization||'').replace('Bearer ','');if(!token)return out(401,{error:'Login required'});
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:{user},error:ue}=await supabase.auth.getUser(token);if(ue||!user)return out(401,{error:'Invalid session'});
  const {productId}=JSON.parse(event.body||'{}');if(!productId)return out(400,{error:'Product id required'});
  const {data:purchase,error:purchaseError}=await supabase.from('purchases').select('id').eq('user_id',user.id).eq('product_id',productId).maybeSingle();
  if(purchaseError)return out(500,{error:'Could not verify purchase'});if(!purchase)return out(403,{error:'This product is not owned by your account'});
  const {data:file,error:fileError}=await supabase.from('product_files').select('storage_path').eq('product_id',productId).eq('is_current',true).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(fileError)return out(500,{error:'Could not load product file'});if(!file)return out(404,{error:'Product file is not available yet'});
  const fileId=String(file.storage_path||'').trim();if(!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))return out(500,{error:'Product Drive file is not configured correctly'});
  const access=await googleAccessToken();
  const metaRes=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=id,name,mimeType,size&supportsAllDrives=true',{headers:{Authorization:'Bearer '+access}});
  if(!metaRes.ok)return out(404,{error:'Google Drive product file could not be accessed'});const meta=await metaRes.json();
  if(!user.email)return out(400,{error:'Account email required'});
  const email=String(user.email).trim().toLowerCase();
  const lp=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'/permissions?supportsAllDrives=true&fields=permissions(id,type,emailAddress,role)',{headers:{Authorization:'Bearer '+access}});
  if(!lp.ok)return out(502,{error:'Could not verify Google Drive file access'});
  const pj=await lp.json(),hasAccess=(pj.permissions||[]).some(p=>p.type==='user'&&String(p.emailAddress||'').toLowerCase()===email&&['reader','commenter','writer','fileOrganizer','organizer','owner'].includes(p.role));
  if(!hasAccess){
   const pr=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'/permissions?supportsAllDrives=true&sendNotificationEmail=false',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({type:'user',role:'reader',emailAddress:user.email})});
   if(!pr.ok)return out(502,{error:'Could not grant file access'});
  }
  const {error:logError}=await supabase.from('download_events').insert({user_id:user.id,product_id:productId});if(logError)console.error('download event log failed',logError.message);
  return out(200,{url:'https://drive.google.com/uc?export=download&id='+encodeURIComponent(meta.id),fileName:meta.name});
 }catch(e){console.error('secure download error',e.message);return out(500,{error:'Secure download error'})}
};
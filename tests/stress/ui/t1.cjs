const fs=require('fs');
module.exports=async({ev})=>ev(fs.readFileSync(__dirname+'/p1.js','utf8'));

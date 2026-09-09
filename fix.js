const paidOpts = site?.paidOptions || customer?.defaultPaidOptions || '';  
if (typeof paidOpts === 'string' && paidOpts.trim()) {  
  paidOpts.split(/[,，、\\n]/).map(o => o.trim()).filter(Boolean).forEach((opt, i) => {  
    checkpoints.push({ id: paid_, label: [옵션]  장착 확인, type: 'OPTION' });  
  });  
} 

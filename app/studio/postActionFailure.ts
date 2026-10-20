export function postActionFailure(error:unknown){
  const value=error&&typeof error==='object'?error as {message?:unknown;status?:unknown}:{};
  const message=typeof value.message==='string'&&value.message.trim()?value.message:'İşlem tamamlanamadı.';
  const status=typeof value.status==='number'?value.status:0;
  return {message,uncertain:!Number.isInteger(status)||status<400||status===408||status>=500};
}

import httpx
from .errors import PlatformError

def request(platform,method,url,token=None,final=False,**kwargs):
    headers=kwargs.pop('headers',{})
    if token: headers['Authorization']='Bearer '+token
    try:
        with httpx.Client(timeout=httpx.Timeout(60,connect=15),follow_redirects=False,trust_env=False) as client:
            response=client.request(method,url,headers=headers,**kwargs)
    except httpx.ConnectError:
        raise PlatformError(platform,'network',retryable=True)
    except httpx.RequestError:
        raise PlatformError(platform,'network',retryable=not final,ambiguous=final)
    if response.status_code==204: return {}
    try: data=response.json()
    except ValueError:
        if response.is_success: return {}
        raise PlatformError(platform,str(response.status_code),retryable=response.status_code>=500,ambiguous=final and response.status_code>=500)
    error=data.get('error')
    if response.is_error or (error and (not isinstance(error,dict) or error.get('code') not in (None,'ok'))):
        code=error.get('code',response.status_code) if isinstance(error,dict) else (error or data.get('code') or response.status_code)
        transient=response.status_code==429 or response.status_code>=500 or str(code) in ('4','17','32','613','rate_limit_exceeded','temporarily_unavailable')
        raise PlatformError(platform,code,retryable=transient,ambiguous=final and response.status_code>=500)
    return data

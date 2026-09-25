import httpx
from .errors import PlatformError

def _safe_reason(error):
    """Classify provider text without exposing its free-form contents to the UI."""
    text=str(error.get('message','')).lower() if isinstance(error,dict) else ''
    if 'api access blocked' in text: return 'api_access_blocked'
    if 'permission' in text or 'izin' in text: return 'permission'
    if 'client secret' in text or 'client_secret' in text: return 'client_secret'
    if 'access token' in text or 'access_token' in text: return 'access_token'
    if 'method' in text: return 'method'
    return ''

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
        raise PlatformError(platform,code,retryable=transient,ambiguous=final and response.status_code>=500,reason=_safe_reason(error))
    return data

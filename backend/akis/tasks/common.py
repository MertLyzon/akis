from ..errors import PlatformError
from ..models import now

class Waiting(Exception):
    def __init__(self,seconds=15,message='Platform medyayı işliyor.'):
        self.seconds,self.message=seconds,message

class Context:
    def __init__(self,db,delivery,content,credential,token,asset):
        self.db,self.delivery,self.content,self.credential,self.token,self.asset=db,delivery,content,credential,token,asset
    @property
    def progress(self): return self.delivery.progress or {}
    def checkpoint(self,**values):
        self.delivery.progress={**self.progress,**values};self.delivery.updated_at=now();self.db.commit()
    def final(self):
        self.delivery.final_request_started=True;self.delivery.updated_at=now();self.db.commit()
    def result(self,identifier,status='sent',note=None):
        if not identifier: raise PlatformError(self.delivery.platform,'missing_id','Platform işlem kimliği döndürmedi. Yeniden göndermeden önce hesabını kontrol et.',ambiguous=True)
        self.delivery.external_post_id=str(identifier);self.delivery.status=status;self.delivery.sent_at=now();self.delivery.error_message=note;self.delivery.error_code=None;self.delivery.final_request_started=False;self.delivery.updated_at=now();self.db.commit()

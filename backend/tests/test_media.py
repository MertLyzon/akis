import subprocess
from PIL import Image
from akis.media import normalize_image,transcode,probe,ffmpeg,path_for
from akis.config import settings

def test_extreme_ratios_and_alpha(tmp_path):
    for size in [(100,4000),(4000,100),(864,1080),(1920,1005)]:
        source=tmp_path/'source.webp';target=tmp_path/'result.jpg'
        Image.new('RGBA',size,(255,0,0,128)).save(source,'WEBP')
        w,h,note=normalize_image(source,target)
        assert .8<=w/h<=1.91,(w,h)
        assert w<=1920 and h<=1080
        with Image.open(target) as img: assert img.format=='JPEG' and img.mode=='RGB'

def test_heic_to_jpeg(tmp_path):
    import pillow_heif
    source=tmp_path/'source.heic';target=tmp_path/'result.jpg'
    pillow_heif.from_pillow(Image.new('RGB',(320,240),'blue')).save(source)
    normalize_image(source,target)
    with Image.open(target) as image: assert image.format=='JPEG'

def test_image_to_h264_aac_video(tmp_path):
    source=tmp_path/'image.jpg';target=tmp_path/'video.mp4';Image.new('RGB',(400,300),'blue').save(source)
    w,h,duration,audio=transcode(source,target,vertical=True,still=True)
    assert (w,h)==(1080,1920) and 3.9<=duration<=4.2 and audio
    info=subprocess.run([ffmpeg(),'-hide_banner','-i',str(target)],capture_output=True).stderr.decode(errors='replace')
    assert 'h264' in info and 'aac' in info

def test_storage_path_traversal_is_rejected():
    import pytest
    with pytest.raises(ValueError): path_for('../secret')

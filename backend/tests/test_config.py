from akis.config import Settings


def test_app_client_origin_defaults_follow_runtime_mode():
    local=Settings(_env_file=None,local_mode=True,app_client_origins='')
    production=Settings(_env_file=None,local_mode=False,app_client_origins='')

    assert 'tauri://localhost' in local.app_client_origins.split(',')
    assert 'http://localhost:1420' in local.app_client_origins.split(',')
    assert 'tauri://localhost' in production.app_client_origins.split(',')
    assert 'http://localhost:1420' not in production.app_client_origins.split(',')


def test_explicit_app_client_origins_are_preserved():
    origins='tauri://localhost,https://shell.example'
    configured=Settings(_env_file=None,local_mode=False,app_client_origins=origins)
    assert configured.app_client_origins==origins

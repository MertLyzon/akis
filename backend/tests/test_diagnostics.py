from akis.diagnostics import clear_api_errors, operational_summary, record_api_error, recent_api_errors


def test_recent_api_errors_are_bounded_newest_first_and_sanitized():
    clear_api_errors()
    try:
        for index in range(25):
            record_api_error(f'{index:012x}', 'get' if index < 24 else 'bad method!', f'/api/item/{index}\n?token=secret', timestamp=100 + index)
        rows = recent_api_errors()
        assert len(rows) == 20
        assert rows[0] == {'at':124,'support_code':'000000000018','method':'?','path':'/api/item/24?'}
        assert rows[-1]['support_code'] == '000000000005'
        assert 'secret' not in str(rows)
    finally:
        clear_api_errors()


def test_operational_summary_prioritizes_critical_and_recent_issues():
    healthy = {'database':True,'redis':True,'worker':True,'beat':True,'storage':True,'checked_at':2_000}
    assert operational_summary(healthy, {}, [], checked_at=2_000) == {'level':'healthy','issues':[],'checked_at':2_000}

    warning = operational_summary(healthy, {'stuck_sending':2,'media_failed':1}, [{'at':1_999},{'at':1_000}], checked_at=2_000)
    assert warning['level'] == 'warning'
    assert warning['issues'] == [
        {'code':'stuck_deliveries','severity':'warning','count':2},
        {'code':'failed_media','severity':'warning','count':1},
        {'code':'recent_api_errors','severity':'warning','count':1},
    ]

    critical = operational_summary({**healthy,'database':False,'worker':False}, {}, [], checked_at=2_000)
    assert critical['level'] == 'critical'
    assert [issue['code'] for issue in critical['issues']] == ['database_unavailable','worker_unavailable']

    configuration = operational_summary(healthy, {}, [], {'checks':[{'code':'cloud_storage','ok':False,'severity':'warning'}]}, checked_at=2_000)
    assert configuration['issues'] == [{'code':'deployment_configuration','severity':'warning','count':1}]

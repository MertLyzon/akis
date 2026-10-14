from akis.diagnostics import clear_api_errors, record_api_error, recent_api_errors


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

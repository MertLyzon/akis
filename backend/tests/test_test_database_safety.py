import pytest
from conftest import safe_test_database_url


def test_default_test_runtime_does_not_use_an_external_database():
    assert safe_test_database_url(None) is None
    assert safe_test_database_url('') is None


@pytest.mark.parametrize('database',['akis_tests','akis_test','test_akis','AKIS_TESTS'])
def test_explicit_disposable_postgres_names_are_accepted_without_connecting(database):
    value=f'postgresql+psycopg://test-user:test-password@127.0.0.1:5432/{database}'
    assert safe_test_database_url(value)==value


@pytest.mark.parametrize('value',[
    'postgresql+psycopg://user:secret@db/akis',
    'postgresql://user:secret@db/postgres',
    'postgresql://user:secret@db/template1',
    'postgresql://user:secret@db/production',
    'postgresql://user:secret@db/',
    'sqlite:///production.db',
    'sqlite:///akis_tests.db',
    'mysql://user:secret@db/akis_tests',
    'not-a-database-url',
])
def test_non_test_names_and_other_engines_stop_before_any_connection(value):
    with pytest.raises(pytest.UsageError) as failure:
        safe_test_database_url(value)
    assert 'secret' not in str(failure.value)
    assert value not in str(failure.value)

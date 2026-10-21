from pathlib import Path

from akis.config import Settings


def test_automatic_backups_are_opt_in_in_code_and_example_configuration():
    assert Settings.model_fields['backup_interval_days'].default==0
    example=(Path(__file__).resolve().parents[2]/'.env.example').read_text()
    assert 'BACKUP_INTERVAL_DAYS=0' in example.splitlines()


def test_explicit_backup_policy_and_existing_retention_are_preserved():
    assert Settings(backup_interval_days=7,_env_file=None).backup_interval_days==7
    assert Settings.model_fields['backup_keep'].default==3

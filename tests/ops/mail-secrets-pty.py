"""PTY-стенд: неизменённый операторский блок, только синтетическая ФС в bwrap."""
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import stat
import subprocess
import sys
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[2]
KEY = 're_synthetic_mail_test_key_012345678901234567890'
SERVICE = 'd' * 64
OLD = b'synthetic-existing-secret-must-survive'


def run(scenario, mutation):
    text = (ROOT / 'docs/HUB-MAIL-DEPLOYMENT.md').read_text()
    blocks = re.findall(r'~~~bash\n(.*?)\n~~~', text, re.S)
    assert len(blocks) == 1
    block = blocks[0] + '\n'
    original_hash = hashlib.sha256(block.encode()).hexdigest()
    if mutation == 'guard':
        before = '''  for GF_MAIL_FILE in secrets/mail_service_secret secrets/resend_api_key; do
    [[ ! -e $GF_MAIL_FILE && ! -L $GF_MAIL_FILE ]] || {
      printf 'Почтовый секрет уже существует; перезапись запрещена\\n' >&2; exit 1;
    }
  done
'''
        assert block.count(before) == 1
        block = block.replace(before, '')
    elif mutation == 'noclobber':
        assert block.count('  set -o noclobber\n') == 1
        block = block.replace('  set -o noclobber\n', '')
    elif mutation == 'trace':
        assert block.count('  set +x\n') == 1
        block = block.replace('  set +x\n', '')
    else:
        assert mutation == 'none'

    with tempfile.TemporaryDirectory(prefix='gf-mail-secret-test-') as temp:
        work = Path(temp)
        fixture = work / 'fixture'
        fixture.mkdir()
        secrets = fixture / 'secrets'
        secrets.mkdir(mode=0o700)
        victim = fixture / 'victim'
        victim.write_bytes(OLD)
        api = secrets / 'resend_api_key'
        service = secrets / 'mail_service_secret'
        if scenario == 'existing-api':
            api.write_bytes(OLD)
        elif scenario == 'existing-service':
            service.write_bytes(OLD)
        elif scenario == 'symlink-api':
            api.symlink_to('../victim')
        elif scenario == 'dangling-service':
            service.symlink_to('../absent')
        elif scenario == 'directory-link':
            secrets.rmdir()
            (fixture / 'private-secrets').mkdir(mode=0o700)
            secrets.symlink_to('private-secrets')
        elif scenario == 'directory-mode':
            secrets.chmod(0o755)

        program = work / 'block.bash'
        program.write_text(block)
        runner = work / 'runner.bash'
        # DEBUG — детерминированные точки отказа/сигнала, не правка проверяемого блока.
        runner.write_text('''set -T
export PATH=/test-bin:/usr/bin:/bin
GF_TEST_FIRED=0
gf_test_debug() {
  local compact=${1//[[:space:]]/}
  (( GF_TEST_FIRED == 0 )) || return 0
  case "$GF_TEST_CASE:$compact" in
    race-first:exec*GF_MAIL_FD*secrets/resend_api_key)
      GF_TEST_FIRED=1; printf '%s' 'synthetic-existing-secret-must-survive' >secrets/resend_api_key ;;
    race-second:exec*GF_MAIL_FD*secrets/mail_service_secret)
      GF_TEST_FIRED=1; printf '%s' 'synthetic-existing-secret-must-survive' >secrets/mail_service_secret ;;
    second-open:exec*GF_MAIL_FD*secrets/mail_service_secret)
      GF_TEST_FIRED=1; mkdir secrets/mail_service_secret ;;
    write-fail:printf*GF_MAIL_RESEND_KEY*GF_MAIL_FD*)
      GF_TEST_FIRED=1; eval "exec ${GF_MAIL_FD}>&-" ;;
    signal-int:printf*GF_MAIL_SERVICE_KEY*GF_MAIL_FD*)
      GF_TEST_FIRED=1; kill -INT "$BASHPID" ;;
    signal-term:chmod0644secrets/resend_api_keysecrets/mail_service_secret)
      GF_TEST_FIRED=1; kill -TERM "$BASHPID" ;;
    registration-gap:'GF_MAIL_CREATED+=(secrets/resend_api_key)')
      GF_TEST_FIRED=1; kill -TERM "$BASHPID" ;;
    registration-gap-second:'GF_MAIL_CREATED+=(secrets/mail_service_secret)')
      GF_TEST_FIRED=1; kill -TERM "$BASHPID" ;;
  esac
  return 0
}
trap 'gf_test_debug "$BASH_COMMAND"' DEBUG
source /run/block.bash
''')
        binaries = work / 'bin'
        binaries.mkdir()
        (binaries / 'openssl').write_text('#!/bin/bash\nprintf %s ' + SERVICE + '\n')
        (binaries / 'chmod').write_text('''#!/bin/bash
if [[ $GF_TEST_CASE == chmod-fail ]]; then exit 42; fi
exec /usr/bin/chmod "$@"
''')
        for binary in binaries.iterdir():
            binary.chmod(0o755)
        args = ['bwrap', '--unshare-all', '--uid', '0', '--gid', '0', '--die-with-parent',
                '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
                '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
                '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp',
                '--dir', '/etc/docker/containers', '--dir', '/run',
                '--bind', str(fixture), '/etc/docker/containers/game-factory',
                '--ro-bind', str(program), '/run/block.bash',
                '--ro-bind', str(runner), '/run/runner.bash',
                '--ro-bind', str(binaries), '/test-bin',
                '--setenv', 'GF_TEST_CASE', scenario,
                '/bin/bash', '-x', '/run/runner.bash']
        master, slave = pty.openpty()

        def terminal():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        child = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave,
                                 preexec_fn=terminal, env={'PATH': os.environ['PATH']})
        os.close(slave)
        output = bytearray()
        prompted = False
        timed_out = False
        key = 'synthetic-invalid-key' if scenario == 'invalid-key' else KEY
        deadline = time.monotonic() + 5
        try:
            while True:
                if time.monotonic() > deadline:
                    timed_out = True
                    os.killpg(child.pid, signal.SIGKILL)
                    break
                readable, _, _ = select.select([master], [], [], 0.05)
                if readable:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            break
                        raise
                    if not chunk:
                        break
                    output.extend(chunk)
                    if not prompted and b'Resend Sending access API key: ' in output:
                        prompted = True
                        os.write(master, (key + '\n').encode())
                elif child.poll() is not None:
                    break
            status = child.wait(timeout=2)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=2)
            os.close(master)
        records = {}
        for path in fixture.rglob('*'):
            info = path.lstat()
            entry = {'mode': stat.S_IMODE(info.st_mode)}
            if path.is_symlink():
                entry.update(kind='symlink', target=os.readlink(path))
            elif stat.S_ISREG(info.st_mode):
                data = path.read_bytes()
                entry.update(kind='file', size=len(data), sha256=hashlib.sha256(data).hexdigest())
            else:
                entry.update(kind='directory')
            records[str(path.relative_to(fixture))] = entry
        return {'scenario': scenario, 'mutation': mutation, 'status': status,
                'prompted': prompted, 'timed_out': timed_out, 'records': records,
                'key_in_output': key.encode() in output, 'service_in_output': SERVICE.encode() in output,
                'namespace_error': b'bwrap:' in output,
                'original_block_sha256': original_hash,
                'executed_block_sha256': hashlib.sha256(block.encode()).hexdigest()}


if __name__ == '__main__':
    try:
        print(json.dumps(run(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'none')))
    except Exception as error:
        # Не отражать возможный вывод дочернего процесса с синтетическим ключом.
        print(json.dumps({'harness_error': type(error).__name__}))
        sys.exit(1)

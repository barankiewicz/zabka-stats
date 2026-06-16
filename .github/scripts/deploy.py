import os
import sys
import paramiko

HOST = os.environ.get('SFTP_HOST')
USER = os.environ.get('SFTP_USER')
PASS = os.environ.get('SFTP_PASS')
REMOTE_ROOT = 'zabka-stats'

if not all([HOST, USER, PASS]):
    print("ERROR: Missing SFTP environment variables!")
    sys.exit(1)

def sftp_mkdir_p(sftp, remote_directory):
    """Recursively create directories over SFTP."""
    path_parts = remote_directory.split('/')
    current_path = ""
    for part in path_parts:
        if not part:
            continue
        current_path += part + "/"
        try:
            sftp.mkdir(current_path)
            print(f"Created remote directory: {current_path}")
        except IOError:
            # Directory already exists
            pass

def upload_dir(sftp, local_dir, remote_dir):
    """Upload folder recursively via SFTP."""
    sftp_mkdir_p(sftp, remote_dir)
    for entry in os.listdir(local_dir):
        # Exclude development/temp and live data directories
        if entry in ('.git', '__pycache__', '.claude', '.github', 'data'):
            continue
        
        local_path = os.path.join(local_dir, entry)
        remote_path = f"{remote_dir}/{entry}"
        
        if os.path.isdir(local_path):
            upload_dir(sftp, local_path, remote_path)
        else:
            print(f"Uploading file: {local_path} -> {remote_path}")
            sftp.put(local_path, remote_path)

if __name__ == '__main__':
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print(f"Connecting to {HOST} over SFTP...")
        ssh.connect(HOST, username=USER, password=PASS)
        sftp = ssh.open_sftp()
        print("SFTP connected successfully! Starting deployment of project files...")
        
        # Ensure remote root exists
        sftp_mkdir_p(sftp, REMOTE_ROOT)
        
        # Upload root level files and directories
        local_root = os.getcwd()
        for entry in os.listdir(local_root):
            # Exclude dev folders and data folders
            if entry in ('.git', '__pycache__', '.claude', '.github', 'data'):
                continue
                
            local_path = os.path.join(local_root, entry)
            remote_path = f"{REMOTE_ROOT}/{entry}"
            
            if os.path.isdir(local_path):
                upload_dir(sftp, local_path, remote_path)
            else:
                print(f"Uploading file: {local_path} -> {remote_path}")
                sftp.put(local_path, remote_path)
                
        print("\nSUCCESS: Project successfully deployed to the server!")
        
    except Exception as e:
        print("\nDeployment failed with error:", e)
        sys.exit(1)
    finally:
        ssh.close()

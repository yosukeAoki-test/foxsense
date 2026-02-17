# update_mist_config.py

import requests
import mist_config

CONFIG_PATH = "mist_config.py"

def update_variable_in_file(var_name, new_value):
    """mist_config.py内の変数を更新。存在しなければ追記"""
    with open(CONFIG_PATH, "r") as f:
        lines = f.readlines()

    updated = False
    with open(CONFIG_PATH, "w") as f:
        for line in lines:
            if line.strip().startswith(f"{var_name}"):
                updated = True
                if isinstance(new_value, str):
                    f.write(f'{var_name} = "{new_value}"\n')
                else:
                    f.write(f"{var_name} = {new_value}\n")
            else:
                f.write(line)

        if not updated:
            if isinstance(new_value, str):
                f.write(f'{var_name} = "{new_value}"\n')
            else:
                f.write(f"{var_name} = {new_value}\n")

def fetch_interval_from_server():
    """mist_coolers テーブルの interval_minutes を取得し、秒に変換"""
    try:
        response = requests.post(
            mist_config.url + "/api/getMistCoolerConfig",
            data={"id": mist_config.terminal_id},
            timeout=5
        )
        config = response.json()
        minutes = config.get("interval_minutes")
        if minutes is not None:
            return int(minutes) * 60
    except Exception as e:
        print("設定取得失敗:", e)
    return None

if __name__ == "__main__":
    interval_sec = fetch_interval_from_server()
    if interval_sec:
        print(f"サーバー設定 interval_sec = {interval_sec}")
        update_variable_in_file("interval_sec", interval_sec)
    else:
        print("interval_minutes の取得に失敗")
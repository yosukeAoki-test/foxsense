#!/bin/sh
#
# rootのcronによって定期的に起動される
# 細霧冷房PGを呼び出す
#
# パラメータ
#  -c 回線接続・切断処理を行う(MBIM)
#  -u モジュールアップデート確認を行う（必要であればアップデート実施）

# 二重起動チェック
PGREP=`pgrep -f $0 -o`
if [ $$ != $PGREP ] && [ $PPID != $PGREP ];
then
  exit 1
fi


# TODO: 要検討
sleep 10

# 通信中なら待機する
for i in `seq 1 10`
do
	ps -aux | grep "mbimcli\|qmi-network" | grep -v grep > /dev/null
	if [ $? = 0 ]; then 
		sleep 3
	else
		break
	fi
done

SCRIPT_DIR=$(cd $(dirname $0); pwd)

# パラメータ解析
while getopts :cpu OPT ; do
        case $OPT in
                "c" ) FLG_C="TRUE";;
                "u" ) FLG_U="TRUE";;
        esac
done

# 接続（失敗時はリトライ）
if [ "$FLG_C" != "" ]; then
        # ネットワークモード判定・接続
        $SCRIPT_DIR/network_mode.sh connect
fi

# 細霧冷房チェック
python3 $SCRIPT_DIR/mist.py

# プログラムの更新チェック
[ "$FLG_U" != "" ] && $SCRIPT_DIR/update.sh $@

# 切断
if [ "$FLG_C" != "" ]; then
        $SCRIPT_DIR/network_mode.sh disconnect
fi

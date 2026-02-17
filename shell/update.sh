#!/bin/sh


# 設定ファイルの読込
SCRIPT_DIR=$(cd $(dirname $0); pwd)
. $SCRIPT_DIR/conf.txt

# update対象のファイル（存在しなければtouchで作成）
CHECK_FILES="cronjob.sh report.sh co2.sh co2.py mist.py mist.sh update.sh rainfall.py soil_sensor_temp.py soil_sensor_vwc.py"
for f in $CHECK_FILES; do
	if [ ! -e $SCRIPT_DIR/$f ]; then
		touch $SCRIPT_DIR/$f
	fi
done

NEW_TERMINAL_FILE_ZIP=/dev/shm/new_terminal_file.zip

rm -r -f $NEW_TERMINAL_FILE_ZIP

# ファイルのチェックサム値をJSON文字列に変換
CHECKSUM_JSON=`(cd $SCRIPT_DIR; md5sum $CHECK_FILES \
	| sed -e 's/\(.*\)  \(.*\)/"\2": "\1"/' \
	| tr '\n' ',' \
	| sed -e 's/,$//')`

JSON="{ \"terminal_id\": ${terminal_id}, \"checksum\": {$CHECKSUM_JSON} }"

# サーバーにチェックサム値をPOSTし、更新ファイルを取得
curl -s -X POST -H "Content-Type: application/json" -d "$JSON" -o $NEW_TERMINAL_FILE_ZIP $url/api/getNewTerminalFile

# 0バイトなら更新なし
if [ ! -s $NEW_TERMINAL_FILE_ZIP ]; then
	exit
fi

# 更新ファイルを展開して上書き
(cd $SCRIPT_DIR; /usr/bin/unzip -o $NEW_TERMINAL_FILE_ZIP)

# 実行すべきコマンドがあれば実行して結果を送る
if ls $SCRIPT_DIR/command.sh.* > /dev/null 2>&1; then
	TERMINAL_COMMAND_ID=`echo $SCRIPT_DIR/command.sh.* | sed 's/.*\.//'`
	COMMAND_RESULT_FILE=/dev/shm/command_result.txt
	sh $SCRIPT_DIR/command.sh.* > $COMMAND_RESULT_FILE 2>&1
	rm -f $SCRIPT_DIR/command.sh.*
	curl -s -X POST -F result=@$COMMAND_RESULT_FILE -F "terminal_command_id=$TERMINAL_COMMAND_ID" $url/api/receiveCommandResult
	rm -f $COMMAND_RESULT_FILE
fi

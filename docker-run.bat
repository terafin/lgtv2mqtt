@echo off
docker run -it --rm ^
    -e TV_MAC=60:AB:14:C5:CA:4E ^
    -e TV_IP=10.0.0.118 ^
    -e BROADCAST_IP=%WOL_BROADCAST_ADDR% ^
    -e TOPIC_PREFIX=lgtv ^
    -e MQTT_HOST=%MQ_HOST% ^
    -e MQTT_NAME=lgtv2mqtt ^
    -e MQTT_USER=%MQ_USER% ^
    -e MQTT_PASS=%MQ_PASS% ^
    -v "A:\Data\lgkey:/usr/node_app/lgkey" ^
    uilton/lgtv2mqtt:latest

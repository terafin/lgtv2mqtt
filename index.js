#!/usr/bin/env node

const Lgtv = require('lgtv2')
const pkg = require('./package.json')
const _ = require('lodash')
const logging = require('./logging.js')
const wol = require('wol')
const mqtt_helpers = require('./mqtt_helpers.js')

let mqttConnected
let tvConnected
let lastError
let foregroundApp = null

const tvMAC = process.env.TV_MAC
const tvIP = process.env.TV_IP
const broadcastIP = process.env.BROADCAST_IP
const clientKeyPath = process.env.CLIENT_KEY_PATH || '/usr/node_app/lgkey/'

const mqttOptions = { retain: true, qos: 1 }
var topic_prefix = process.env.TOPIC_PREFIX

if (_.isNil(topic_prefix)) {
    logging.error('TOPIC_PREFIX not set, not starting')
    process.abort()
}


logging.info(pkg.name + ' ' + pkg.version + ' starting')

const mqtt = mqtt_helpers.setupClient(function() {
    mqttConnected = true

    mqtt.publish(topic_prefix + '/connected', tvConnected ? '1' : '0', mqttOptions)

    logging.info('mqtt subscribe', topic_prefix + '/set/#')
    mqtt.subscribe(topic_prefix + '/set/#', { qos: 1 })
}, function() {
    if (mqttConnected) {
        mqttConnected = false
        logging.error('mqtt disconnected')
    }
})

const powerOff = function() {
    logging.info('power_off')
    logging.info('lg > ssap://system/turnOff')
    lgtv.request('ssap://system/turnOff', null, null)
}

const powerOn = function () {
    logging.info('power_on')
    wol.wake(tvMAC, {
        address: broadcastIP
    },function(err, res) {
        logging.info('WOL: ' + res)
        if (foregroundApp == null) {
            logging.info('lg > ssap://system/turnOff (to turn it on...)')
            lgtv.request('ssap://system/turnOff', null, null)
        }
    })
}

const lgtv = new Lgtv({
    url: 'ws://' + tvIP + ':3000',
    reconnect: 1000,
    keyFile: `${clientKeyPath}keyfile-${tvIP.replace(/[a-z]+:\/\/([0-9a-zA-Z-_.]+):[0-9]+/, '$1')}`
})

mqtt.on('error', err => {
    logging.error('mqtt: ' + err)
})

mqtt.on('message', (inTopic, inPayload) => {
    var topic = inTopic
    var payload = String(inPayload)
    logging.info('mqtt <' + topic + ':' + payload)

    if (topic[0] == '/') {
        topic = topic.substring(1)
    }

    const parts = topic.split('/')

    switch (parts[1]) {
        case 'set':
            switch (parts[2]) {
                case 'toast':
                    logging.info(`lg > ssap://system.notifications/createToast:${payload}`)
                    lgtv.request('ssap://system.notifications/createToast', { message: String(payload) })
                    break

                case 'volume':
                    const volume = parseInt(payload, 10);
                    logging.info(`lg > ssap://audio/setVolume:${volume}`)
                    lgtv.request('ssap://audio/setVolume', { volume: volume })
                    break

                case 'mute':
                    const mute = Boolean(!(payload === 'false' || payload === '0'))
                    logging.info(`lg > ssap://audio/setMute:${mute}`)
                    lgtv.request('ssap://audio/setMute', { mute: mute })
                    break

                case 'input':
                    logging.info(`lg > ssap://tv/switchInput:${JSON.stringify({ inputId: String(payload) })}`)
                    lgtv.request('ssap://tv/switchInput', { inputId: String(payload) })
                    break

                case 'launch':
                    logging.info(`lg > ssap://system.launcher/launch:${payload}`)
                    lgtv.request('ssap://system.launcher/launch', { id: String(payload) })
                    break

                case 'system_launch_json':
                    try {
                        logging.info(`lg > ssap://system.launcher/launch:${payload}`)
                        lgtv.request('ssap://system.launcher/launch', JSON.parse(payload))
                    } catch (e) {
                        logging.error(e)
                    }
                    break

                case 'am_launch_json':
                    try {
                        logging.info(`lg > ssap://com.webos.applicationManager/launch:${payload}`)
                        lgtv.request('ssap://com.webos.applicationManager/launch', JSON.parse(payload))
                    } catch (e) {
                        logging.error(e)
                    }
                    break

                case 'move':
                case 'drag':
                    try {
                        const jsonPayload = JSON.parse(payload)
                        // The event type is 'move' for both moves and drags.
                        sendPointerEvent('move', {
                            dx: jsonPayload.dx,
                            dy: jsonPayload.dy,
                            drag: parts[2] === 'drag' ? 1 : 0
                        })
                    } catch (e) {
                        logging.error(e)
                    }
                    break

                case 'scroll':
                    try {
                        const jsonPayload = JSON.parse(payload)
                        sendPointerEvent('scroll', {
                            dx: jsonPayload.dx,
                            dy: jsonPayload.dy
                        })
                    } catch (e) {
                        logging.error(e)
                    }
                    break

                case 'click':
                    sendPointerEvent('click')
                    break

                case 'power':
                    if (Boolean(!(payload === 'false' || payload === '0'))) {
                        powerOn()
                    } else {
                        powerOff()
                    }
                    break

                case 'button':
                    /*
                     * Buttons that are known to work:
                     *    MUTE, RED, GREEN, YELLOW, BLUE, HOME, MENU, VOLUMEUP, VOLUMEDOWN,
                     *    CC, BACK, UP, DOWN, LEFT, ENTER, DASH, 0-9, EXIT, CHANNELUP, CHANNELDOWN
                     */
                    sendPointerEvent('button', { name: (String(payload)).toUpperCase() })
                    break

                case 'open':
                case 'open_max':
                    lgtv.request('ssap://system.launcher/open', {target: String(payload)});
                    if (parts[2] === 'open_max') setTimeout(clickMax, 5000);
                    break;

                case 'netflix':
                    lgtv.request('ssap://system.launcher/launch', !!payload ? {
                        "id": "netflix",
                        "contentId": `m=http://api.netflix.com/catalog/titles/movies/${payload}&source_type=4`
                    } : {
                        "id": "netflix"
                    })
                    break

                case 'amazon_prime':
                    lgtv.request('ssap://system.launcher/launch', { id: 'amazon' })
                    break

                case 'web_video_caster':
                    lgtv.request('ssap://system.launcher/launch', { id: 'com.instantbits.cast.webvideo' });
                    break

                case 'youtube':
                    lgtv.request('ssap://com.webos.applicationManager/launch', !!payload ? {
                        id: 'youtube.leanback.v4',
                        params: {
                            contentTarget: `https://www.youtube.com/tv?v=${payload}`
                        }
                    } : {id: 'youtube.leanback.v4'});
                    break

                case 'plex':
                    lgtv.request('ssap://system.launcher/launch', { id: 'cdp-30' })
                    break

                default:
                    const path = topic.replace(topic_prefix + '/set/', '')
                    const jsonPayload = !!payload ? JSON.parse(payload) : null
                    logging.info(`lg > 'ssap://${path}:${payload || 'null'}`)
                    lgtv.request(`ssap://${path}`, jsonPayload)
            }
            break
        default:
    }
})

lgtv.on('prompt', () => {
    logging.info('authorization required')
})

lgtv.on('connect', () => {
    let channelsSubscribed = false
    lastError = null
    tvConnected = true
    logging.info('tv connected')
    mqtt.publish(topic_prefix + '/connected', '1', mqttOptions)

    lgtv.subscribe('ssap://audio/getVolume', (err, res) => {
        logging.info('audio/getVolume', err, res)
        if (res.changed.indexOf('volume') !== -1) {
            mqtt.publish(topic_prefix + '/status/volume', String(res.volume), mqttOptions)
        }
        if (res.changed.indexOf('muted') !== -1) {
            mqtt.publish(topic_prefix + '/status/mute', res.muted ? '1' : '0', mqttOptions)
        }
    })

    lgtv.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo', (err, res) => {
        logging.info('getForegroundAppInfo', err, res)
        mqtt.publish(topic_prefix + '/status/foregroundApp', String(res.appId), mqttOptions)

        if (!_.isNil(res.appId) && res.appId.length > 0) {
            foregroundApp = res.appId
        } else {
            foregroundApp = null
        }

        if (res.appId === 'com.webos.app.livetv') {
            if (!channelsSubscribed) {
                channelsSubscribed = true
                setTimeout(() => {
                    lgtv.subscribe('ssap://tv/getCurrentChannel', (err, res) => {
                        if (err) {
                            logging.error(err)
                            return
                        }
                        const msg = {
                            val: res.channelNumber,
                            lgtv: res
                        }
                        mqtt.publish(topic_prefix + '/status/currentChannel', JSON.stringify(msg), mqttOptions)
                    })
                }, 2500)
            }
        }
    })

    lgtv.subscribe('ssap://tv/getExternalInputList', function(err, res) {
        logging.info('getExternalInputList', err, res)
    })
})

lgtv.on('connecting', host => {
    logging.info('tv trying to connect', host)
})

lgtv.on('close', () => {
    lastError = null
    tvConnected = false
    logging.info('tv disconnected')
    mqtt.publish(topic_prefix + '/connected', '0', mqttOptions)
})

lgtv.on('error', err => {
    const str = String(err)
    if (str !== lastError) {
        logging.error('tv error: ' + str)
    }
    lastError = str
})

const sendPointerEvent = function(type, payload) {
    logging.info(`lg > ssap://com.webos.service.networkinput/getPointerInputSocket | type: ${type} | payload: ${JSON.stringify(payload)}`)
    lgtv.getSocket(
        'ssap://com.webos.service.networkinput/getPointerInputSocket',
        (err, sock) => {
            if (!err) {
                sock.send(type, payload)
            }
        }
    )
}

const clickMax = function() {
    lgtv.getSocket('ssap://com.webos.service.networkinput/getPointerInputSocket',
        function(err, sock) {
            if (!err) {
                const command = "move\ndx:11\ndy:-8\ndown:0\n\n";
                for (let i=0; i < 22; i++) {
                    sock.send(command);
                }
                setTimeout(()=>sock.send('click'), 1000);
            }
        });
}

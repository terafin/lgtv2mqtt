#!/usr/bin/env node

const log = require('yalm')
const Mqtt = require('mqtt')
const Lgtv = require('lgtv2')
var config = require('./config.js')
const pkg = require('./package.json')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')


let tvOn
let mqttConnected
let tvConnected
let lastError

require('homeautomation-js-lib/mqtt_helpers.js')
const tvIP = process.env.TV_IP
if ( !_.isNil(tvIP) ) { 
	config.tv = tvIP 
}
var topic_prefix = process.env.TOPIC_PREFIX

if (_.isNil(topic_prefix)) {
	logging.warn('TOPIC_PREFIX not set, not starting')
	process.abort()
}


logging.info(pkg.name + ' ' + pkg.version + ' starting')
logging.info('mqtt trying to connect', config.url)

const mqtt = Mqtt.setupClient(function() {
	mqttConnected = true

	logging.info('mqtt connected', config.url)
	mqtt.publish(topic_prefix + '/connected', tvConnected ? '2' : '1', {retain: true})

	logging.info('mqtt subscribe', topic_prefix + '/set/#')
	mqtt.subscribe(topic_prefix + '/set/#')
}, function() {
	if (mqttConnected) {
		mqttConnected = false
		logging.info('mqtt closed ' + config.url)
	}
})

const lgtv = new Lgtv({
	url: 'ws://' + config.tv + ':3000',
	reconnect: 5000
})

mqtt.on('error', err => {
	logging.error('mqtt', err)
})

mqtt.on('message', (inTopic, inPayload) => {
	var topic = inTopic
	var payload = String(inPayload)
	try {
		payload = JSON.parse(payload)
	} catch (err) {
		logging.error('error on mqtt message JSON parsing: ' + err)
	}

	logging.debug('mqtt <', topic, payload)

	if (topic[0] == '/') { 
		topic = topic.substring(1)
	}
      
	const parts = topic.split('/')

	switch (parts[1]) {
	case 'set':
		switch (parts[2]) {
		case 'toast':
			lgtv.request('ssap://system.notifications/createToast', {message: String(payload)})
			break
		case 'volume':
			lgtv.request('ssap://audio/setVolume', {volume: parseInt(payload, 10)} || 0)
			break
		case 'mute':
			if (payload === 'true') {
				payload = true
			}
			if (payload === 'false') {
				payload = false
			}
			lgtv.request('ssap://audio/setMute', {mute: Boolean(payload)})
			break
            
		case 'input':
			logging.info('lg > ssap://tv/switchInput', {inputId: String(payload)})
			lgtv.request('ssap://tv/switchInput', {inputId: String(payload)})
			break

		case 'launch':
			lgtv.request('ssap://system.launcher/launch', {id: String(payload)})
			break

		case 'powerOn':
			logging.info('powerOn (isOn? ' + tvOn + ')')
			if ( !tvOn ) { 
				logging.info('lg > ssap://system/turnOff')
				lgtv.request('ssap://system/turnOff', null, null) 
				tvOn = true
			}
			break

		case 'powerOff':
			logging.info('powerOff (isOn? ' + tvOn + ')')
			if ( tvOn ) { 
				logging.info('lg > ssap://system/turnOff')
				lgtv.request('ssap://system/turnOff', null, null) 
				tvOn = false
			}
			break

		case 'button':
			/*
                     * Buttons that are known to work:
                     *    MUTE, RED, GREEN, YELLOW, BLUE, HOME, MENU, VOLUMEUP, VOLUMEDOWN,
                     *    CC, BACK, UP, DOWN, LEFT, ENTER, DASH, 0-9, EXIT
                     *
                     * Probably also (but I don't have the facility to test them):
                     *    CHANNELUP, CHANNELDOWN
                     */
			sendPointerEvent('button', {name: (String(payload)).toUpperCase()})
			break

		default:
			logging.info('lg > ' + 'ssap://' + inPayload)
			lgtv.request('ssap://' + inPayload, null, null)
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
	mqtt.publish(topic_prefix + '/connected', '2', {retain: true})

	lgtv.subscribe('ssap://audio/getVolume', (err, res) => {
		logging.info('audio/getVolume', err, res)
		if (res.changed.indexOf('volume') !== -1) {
			mqtt.publish(topic_prefix + '/status/volume', String(res.volume), {retain: true})
		}
		if (res.changed.indexOf('muted') !== -1) {
			mqtt.publish(topic_prefix + '/status/mute', res.muted ? '1' : '0', {retain: true})
		}
	})

	lgtv.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo', (err, res) => {
		logging.info('getForegroundAppInfo', err, res)
		mqtt.publish(topic_prefix + '/status/foregroundApp', String(res.appId), {retain: true})

		if ( !_.isNil(res.appId) && res.appId.length > 0) {
			tvOn = true
		} else {
			tvOn = false
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
						mqtt.publish(topic_prefix + '/status/currentChannel', JSON.stringify(msg), {retain: true})
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
	logging.debug('tv trying to connect', host)
})

lgtv.on('close', () => {
	lastError = null
	tvConnected = false
	logging.info('tv disconnected')
	mqtt.publish(topic_prefix + '/connected', '0', {retain: true})
})

lgtv.on('error', err => {
	const str = String(err)
	if (str !== lastError) {
		logging.error('tv', str)
	}
	lastError = str
})

const sendPointerEvent = function(type, payload) {
	lgtv.getSocket(
		'ssap://com.webos.service.networkinput/getPointerInputSocket',
		(err, sock) => {
			if (!err) {
				sock.send(type, payload)
			}
		}
	)
}

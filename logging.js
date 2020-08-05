const _ = require('lodash')
const fs = require('fs')
const disableSyslog = process.env.DISABLE_SYSLOG

var logName = process.env.name

if (_.isNil(logName)) {
	logName = process.env.LOGGING_NAME
}

if (_.isNil(logName)) {
	logName = 'logger'
}

const winston = require('winston')

require('winston-daily-rotate-file')

const timezoned = () => {
	return new Date().toLocaleTimeString('en-US', {
		year: 'numeric',
		day: 'numeric',
		month: 'numeric',
		dateStyle: 'full',
		timeZoneName: 'short',
		timeStyle: 'full',
		timeZone: process.env.TZ
	})
}
  
const logFormat = function(shouldColor) {
	if (shouldColor) {
		return winston.format.combine(
			winston.format.label({label: '[' + logName + ']'}),
			winston.format.colorize(),
			winston.format.timestamp({
				format: timezoned
			}),
			winston.format.printf(info => `${info.timestamp} ${info.label} ${info.level}: ${info.message}`))
	}

	return winston.format.combine(
		winston.format.label({label: '[' + logName + ']'}),
		winston.format.timestamp({
			format: timezoned
		}),
		winston.format.printf(info => `${info.timestamp} ${info.label} ${info.level}: ${info.message}`))

}

const canWrite = function(directory) {
	var stat = fs.statSync(directory)

	// 2 is the octal value for chmod -w-
	return !!(2 & (stat.mode & parseInt('777', 8)).toString(8)[0]) //first char is the owner
}

var dailyFileLogger = null
const loggingPath = '/var/log'

if (!canWrite(loggingPath)) {
	dailyFileLogger = new (winston.transports.DailyRotateFile)({
		level: 'silly',
		filename: 'application-%DATE%.log',
		datePattern: 'YYYY-MM-DD-HH',
		zippedArchive: true,
		maxSize: '20m',
		maxFiles: '7d',
		dirname: loggingPath,
		format: logFormat(false)
	})
}

const consoleLogger = new winston.transports.Console({
	level: 'info',
	format: logFormat(true)
})

var logger = winston.createLogger({
	levels: winston.config.cli.levels,
	transports: _.isNil(dailyFileLogger) ? [consoleLogger] : [consoleLogger, dailyFileLogger]
})

console.log('starting logging for: ' + logName)

if (disableSyslog !== false) {
	logger.info(' => console logging enabled')
}

module.exports = logger

/**
 * @fileoverview Sistema de logging estructurado usando Winston.
 */
const winston = require('winston');
const path = require('path');
const config = require('../config/env');

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
    )
  })
];

if (config.debugArtifacts) {
  transports.push(
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/combined.log')
    })
  );
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`)
  ),
  transports
});

module.exports = logger;

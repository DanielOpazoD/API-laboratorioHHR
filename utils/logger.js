/**
 * @fileoverview Sistema de logging estructurado usando Winston.
 */
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: () => new Date().toISOString() }),
    winston.format.printf(info => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`)
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
      )
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/error.log'),
      maxsize: 1_000_000, maxFiles: 3,
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/combined.log'),
      maxsize: 1_000_000, maxFiles: 3
    })
  ]
});

module.exports = logger;

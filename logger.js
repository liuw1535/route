// logger.js
const winston = require('winston');
const path = require('path');

// 创建日志格式
const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.printf(info => {
        return `${info.timestamp} ${info.level}: ${info.message}`;
    })
);

// 创建 logger 实例
const logger = winston.createLogger({
    format: logFormat,
    transports: [
        // 控制台输出
        new winston.transports.Console(),
        // API 调用日志文件
        new winston.transports.File({
            filename: path.join('logs', 'api-calls.log'),
            level: 'info'
        }),
        // 错误日志文件
        new winston.transports.File({
            filename: path.join('logs', 'errors.log'),
            level: 'error'
        })
    ]
});

module.exports = logger;
'use strict';

const fs = require('fs');
const path = require('path');

function timestamp() {
    return new Date().toISOString();
}

function createLogger(scope, options = {}) {
    const file = options.logFile === undefined ? path.join(process.cwd(), 'logs', 'minebbs.log') : options.logFile;
    function write(level, args) {
        const line = `[${timestamp()}] [${level}]${scope ? ` [${scope}]` : ''} ${args.map(formatArg).join(' ')}`;
        if (!options.silent) {
            const sink = level === 'ERROR' ? console.error : console.log;
            sink(line);
        }
        if (!file) {
            return;
        }
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.appendFileSync(file, `${line}\n`);
        } catch (error) {
            console.error(`[${timestamp()}] [ERROR] 写入日志失败: ${error.message}`);
        }
    }
    return {
        info(...args) {
            write('INFO', args);
        },
        warn(...args) {
            write('WARN', args);
        },
        error(...args) {
            write('ERROR', args);
        },
        child(nextScope) {
            return createLogger(scope ? `${scope}:${nextScope}` : nextScope, options);
        },
    };
}

function formatArg(value) {
    if (value instanceof Error) {
        return value.stack || value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch (error) {
        return String(value);
    }
}

module.exports = { createLogger };

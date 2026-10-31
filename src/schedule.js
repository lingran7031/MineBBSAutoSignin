'use strict';

const schedule = require('node-schedule');
const { loadConfig, parseExecuteTime } = require('./config');
const { createLogger } = require('./logger');
const { runRoutine } = require('./routine');

let currentJob = null;

function startSchedule(options = {}) {
    const logger = options.logger || createLogger('schedule');
    const config = options.config || loadConfig();
    const time = parseExecuteTime(config.executeTime);
    if (currentJob) {
        currentJob.cancel();
    }
    currentJob = schedule.scheduleJob(time, async () => {
        logger.info('定时任务触发，开始执行每日流程...');
        try {
            await runRoutine({ logger });
            logger.info('每日流程完成');
        } catch (error) {
            logger.error('每日流程失败:', error);
        }
    });
    logger.info(`定时任务已启动，将在每天 ${config.executeTime} 执行`);
    return currentJob;
}

function stopSchedule() {
    if (currentJob) {
        currentJob.cancel();
        currentJob = null;
    }
}

module.exports = { startSchedule, stopSchedule, parseExecuteTime };

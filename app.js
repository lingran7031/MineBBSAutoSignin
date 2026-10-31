'use strict';

const { startSchedule, stopSchedule } = require('./src/schedule');
const { runRoutine } = require('./src/routine');
const { startWeb, stopWeb } = require('./server');

function main() {
    const job = startSchedule();
    startWeb();
    process.once('SIGINT', () => {
        console.log('\n正在停止定时任务...');
        stopSchedule();
        stopWeb();
        console.log('定时任务已停止');
        process.exit(0);
    });
    return job;
}

async function runOnce() {
    return runRoutine();
}

module.exports = { startSchedule, stopSchedule, runOnce, main };

if (require.main === module) {
    main();
}

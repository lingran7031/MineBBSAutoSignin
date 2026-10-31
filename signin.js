'use strict';

const { main } = require('./cli');

async function signin() {
    const code = await main(['signin']);
    if (code !== 0) {
        throw new Error('签到失败');
    }
}

module.exports = signin;

if (require.main === module) {
    signin().catch((error) => {
        console.error(error.message || error);
        process.exit(1);
    });
}

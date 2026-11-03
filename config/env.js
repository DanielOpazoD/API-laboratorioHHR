require('dotenv').config({ quiet: true });

const decodeEnv = (encoded, plain) => encoded === undefined
  ? plain || '' : Buffer.from(encoded, 'base64').toString('utf8');

module.exports = {
  host: process.env.HOST || '127.0.0.1',
  port: process.env.PORT || 3100,
  apiToken: decodeEnv(process.env.SYSLAB_API_TOKEN_BASE64, process.env.SYSLAB_API_TOKEN),
  syslab: {
    baseUrl: process.env.SYSLAB_BASE_URL || 'http://10.4.69.90/syslab/',
    user: decodeEnv(process.env.SYSLAB_USER_BASE64, process.env.SYSLAB_USER),
    pass: decodeEnv(process.env.SYSLAB_PASS_BASE64, process.env.SYSLAB_PASS)
  }
};

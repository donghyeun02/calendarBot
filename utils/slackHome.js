const { App, SocketModeReceiver } = require('@slack/bolt');
const { v4 } = require('uuid');
const { google } = require('googleapis');
const {
  updateReminderTime,
  updateSlackChannel,
  updateCalendarId,
  getSlackChannelByuserId,
  getCalendarByuserId,
  getResourceIdByuserId,
} = require('../models/slackDao');
const {
  userExist,
  getRefreshTokenByUserID,
  updateWebHook,
} = require('../models/calendarDao');
const { oauth2Client } = require('../utils/oauth2');

const calendar = google.calendar('v3');

const socketModeReceiver = new SocketModeReceiver({
  signingSecret: process.env.SLACK_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  processBeforeResponse: true,
});

const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: socketModeReceiver,
});

const afterLoginBlock = async (option) => {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '구글 캘린더 알리미',
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      block_id: 'channel_select',
      text: {
        type: 'mrkdwn',
        text: '알림받을 채널을 선택해주세요.',
      },
      accessory: {
        type: 'channels_select',
        action_id: 'selected_channel',
        response_url_enabled: true,
        placeholder: {
          type: 'plain_text',
          text: '채널 선택',
        },
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '캘린더 선택',
      },
      accessory: {
        type: 'static_select',
        placeholder: {
          type: 'plain_text',
          text: '캘린더 목록',
          emoji: true,
        },
        options: option,
        action_id: 'selected_calendar',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '채널과 캘린더 선택 후 등록해주세요.',
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '웹훅 등록하기',
          emoji: true,
        },
        value: 'webhook',
        style: 'primary',
        action_id: 'webhook_button',
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '구글 캘린더 리마인더',
      },
    },
    {
      type: 'section',
      block_id: 'select_time',
      text: {
        type: 'mrkdwn',
        text: '캘린더 리마인더 시간대를 설정해주세요',
      },
      accessory: {
        type: 'timepicker',
        initial_time: '00:00',
        placeholder: {
          type: 'plain_text',
          text: 'Select time',
          emoji: true,
        },
        action_id: 'time',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '로그아웃',
            emoji: true,
          },
          value: 'google logout',
          style: 'primary',
          action_id: 'google_logout',
        },
      ],
    },
  ];

  return blocks;
};

slackApp.event('app_home_opened', async ({ event, client }) => {
  try {
    const slackUserId = event.user;

    const ExistingUser = await userExist(slackUserId);

    if (ExistingUser === '0') {
      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '구글 캘린더 알리미',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Google Login',
                emoji: true,
              },
              value: 'google login',
              url: `https://donghyeun02.link/?slackUserId=${slackUserId}`,
              style: 'primary',
              action_id: 'google_login',
            },
          ],
        },
      ];

      return await client.views.publish({
        user_id: slackUserId,
        view: {
          type: 'home',
          callback_id: 'home_view',
          blocks: blocks,
        },
      });
    } else if (ExistingUser === '1') {
      const option = await getCalendarList(slackUserId);

      const blocks = await afterLoginBlock(option);

      return await client.views.publish({
        user_id: slackUserId,
        view: {
          type: 'home',
          callback_id: 'home_view',
          blocks: blocks,
        },
      });
    }
  } catch (error) {
    console.error('Error:', error);
  }
});

slackApp.action('selected_channel', async ({ ack, body }) => {
  ack();

  const userId = body.user.id;
  const slackChannel = body.actions[0].selected_channel;

  await updateSlackChannel(userId, slackChannel);
});

slackApp.action('selected_calendar', async ({ ack, body }) => {
  ack();

  const userId = body.user.id;
  const calendar = body.actions[0].selected_option.value;

  await updateCalendarId(calendar, userId);
});

slackApp.action('webhook_button', async ({ ack, body, client }) => {
  ack();

  const userId = body.user.id;

  const calendarId = await getCalendarByuserId(userId);
  const channelId = await getSlackChannelByuserId(userId);
  const webhook = await getResourceIdByuserId(userId);

  if (!calendarId || !channelId) {
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'error_modal',
          title: {
            type: 'plain_text',
            text: '오류',
          },
          blocks: [
            {
              type: 'section',
              block_id: 'error_message',
              text: {
                type: 'mrkdwn',
                text: '채널 및 캘린더를 선택해주세요.',
              },
            },
          ],
        },
      });
    } catch (error) {
      console.error('조건에 맞지않는 모달창 오류 :', error);
    }
  } else if (!!webhook) {
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'error_modal',
          title: {
            type: 'plain_text',
            text: '오류',
          },
          blocks: [
            {
              type: 'section',
              block_id: 'error_message',
              text: {
                type: 'mrkdwn',
                text: '웹훅이 이미 등록되어 있습니다.',
              },
            },
          ],
        },
      });
    } catch (error) {
      console.error('웹훅이 이미 등록되어있을 때 모달창 오류 :', error);
    }
  } else {
    try {
      await calendarWebhook(userId, calendarId);

      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'success_modal',
          title: {
            type: 'plain_text',
            text: '웹훅 등록',
          },
          blocks: [
            {
              type: 'section',
              block_id: 'error_message',
              text: {
                type: 'mrkdwn',
                text: '웹훅이 등록되었습니다.',
              },
            },
          ],
        },
      });
    } catch (error) {
      console.error('웹훅 등록 오류 :', error);
    }
  }
});

slackApp.action('time', async ({ ack, body }) => {
  ack();

  const userId = body.user.id;
  const time = body.actions[0].selected_time;

  await updateReminderTime(time, userId);
});

const getCalendarList = async (slackUserId) => {
  const refreshToken = await getRefreshTokenByUserID(slackUserId);

  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const calendars = await calendar.calendarList.list({
    auth: oauth2Client,
    showDeleted: true,
  });

  const calendarList = calendars.data.items;

  const calendarOptions = [];

  if (calendarList.length) {
    calendarList.forEach((calendar) => {
      const option = {
        text: {
          type: 'plain_text',
          text: calendar.summary,
          emoji: true,
        },
        value: calendar.id,
      };
      calendarOptions.push(option);
    });

    return calendarOptions;
  } else {
    const option = {
      text: {
        type: 'plain_text',
        text: '캘린더 없음.',
        emoji: true,
      },
      value: 'no calendar list',
    };
    calendarOptions.push(option);
  }

  return calendarOptions;
};

const calendarWebhook = async (userId, calendarId) => {
  try {
    const webhookId = v4();

    const refreshToken = await getRefreshTokenByUserID(userId);

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const getAccessToken = await oauth2Client.getAccessToken();
    const accessToken = getAccessToken.token;

    const webhook = await calendar.events.watch({
      resource: {
        id: webhookId,
        type: 'web_hook',
        address: 'https://donghyeun02.link/calendar-webhook',
        params: {
          ttl: 300,
        },
      },
      calendarId: calendarId,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: `application/json`,
      },
    });

    const { data } = webhook;

    const resourceId = data.resourceId;

    await updateWebHook(resourceId, calendarId);

    console.log('Google Calendar Webhook이 설정되었습니다. : ', data);
  } catch (error) {
    console.error('Google Calendar Webhook 설정 에러 :', error);
    throw error;
  }
};

module.exports = { slackApp, afterLoginBlock, getCalendarList };
// Netlify function for managing registered Telegram users
let inMemoryUsers = [];

exports.handler = async (event) => {
  const method = event.httpMethod;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const action = event.queryStringParameters?.action || 'list';

    if (method === 'POST' || action === 'register') {
      let userData;
      try {
        userData = event.body ? JSON.parse(event.body) : event.queryStringParameters;
      } catch (e) {
        userData = event.queryStringParameters;
      }

      if (userData && userData.id) {
        const idStr = String(userData.id);
        const existingIndex = inMemoryUsers.findIndex(u => String(u.id) === idStr);
        const userObj = {
          id: idStr,
          first_name: userData.first_name || '',
          last_name: userData.last_name || '',
          username: userData.username || '',
          platform: userData.platform || 'web',
          registeredAt: existingIndex > -1 ? inMemoryUsers[existingIndex].registeredAt : new Date().toISOString(),
          lastSeen: new Date().toISOString()
        };

        if (existingIndex > -1) {
          inMemoryUsers[existingIndex] = { ...inMemoryUsers[existingIndex], ...userObj };
        } else {
          inMemoryUsers.unshift(userObj);
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'User registered', totalUsers: inMemoryUsers.length, user: userObj })
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, message: 'User ID is required' })
      };
    }

    if (action === 'list') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, count: inMemoryUsers.length, users: inMemoryUsers })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, users: inMemoryUsers })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

let cache = {};

exports.handler = async (event) => {
  const endpoint = event.queryStringParameters.endpoint;

  if (cache[endpoint]) {
    return {
      statusCode: 200,
      body: JSON.stringify(cache[endpoint]),
    };
  }

  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`
    }
  });

  const data = await res.json();
  cache[endpoint] = data;

  return {
    statusCode: 200,
    body: JSON.stringify(data),
  };
};

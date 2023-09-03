export default async function sendMoodleRequest(
  params: any
): Promise<{ result: { ok: boolean; status: number }; json: any }> {
  const formBody = [];
  for (const [key, value] of Object.entries(params)) {
    var encodedKey = encodeURIComponent(key);
    var encodedValue = encodeURIComponent(value as string | number);
    formBody.push(encodedKey + "=" + encodedValue);
  }
  const formBodyString = formBody.join("&");

  const result = await fetch(
    "https://irdesieducacao.com.br/ava/webservice/rest/server.php",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBodyString,
    }
  );
  const json = await result.json();
  return { result: { ok: result.ok, status: result.status }, json };
}

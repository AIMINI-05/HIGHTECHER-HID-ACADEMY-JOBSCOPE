import { onRequest } from "firebase-functions/v2/https";
import * as https from "https";
import { logger } from "firebase-functions/v2";

const ALLOWED_ORIGIN = "https://hightecher-academy-job.web.app";

function setCors(res: any) {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function decodeEucKr(buf: Buffer): string {
  try {
    return new TextDecoder("euc-kr").decode(buf);
  } catch {
    return buf.toString("utf-8");
  }
}

function cleanXml(raw: string): string {
  let xml = raw.replace(/^\uFEFF/, ""); // BOM 제거
  const xmlStart = xml.indexOf("<?xml");
  if (xmlStart > 0) xml = xml.slice(xmlStart);
  xml = xml.replace(/encoding=["']euc-kr["']/gi, 'encoding="UTF-8"');
  return xml.trim();
}

function makeProxy(targetUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // http → https 로 변경
    const url = targetUrl.replace(/^http:\/\//i, "https://");
    logger.info("[proxy] HTTPS 요청:", url);

    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/xml, application/xml, */*",
      }
    }, (apiRes) => {
      // 리다이렉트 처리
      if (apiRes.statusCode && apiRes.statusCode >= 300 && apiRes.statusCode < 400) {
        const location = apiRes.headers.location;
        logger.warn("[proxy] 리다이렉트:", apiRes.statusCode, "→", location);
        if (location) {
          makeProxy(location).then(resolve).catch(reject);
          return;
        }
      }

      const chunks: Buffer[] = [];
      apiRes.on("data", (chunk: Buffer) => chunks.push(chunk));
      apiRes.on("end", () => {
        const buf = Buffer.concat(chunks);
        const xml = cleanXml(decodeEucKr(buf));
        logger.info("[proxy] 응답 길이:", xml.length, "첫 150자:", xml.slice(0, 150));
        resolve(xml);
      });
      apiRes.on("error", reject);
    }).on("error", reject);
  });
}

export const jkproxy = onRequest(
  { region: "asia-northeast3" },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    try {
      const qs = new URLSearchParams(req.query as Record<string, string>).toString();
      const targetUrl = `https://www.jobkorea.co.kr/Service_JK/Data/JK_GI_XML_List.asp?${qs}`;
      logger.info("[jkproxy] 요청:", targetUrl);
      const xml = await makeProxy(targetUrl);
      res.set("Content-Type", "application/xml; charset=utf-8");
      res.status(200).send(xml);
    } catch (err) {
      logger.error("[jkproxy] 오류:", err);
      res.status(500).send("API 호출 실패: " + String(err));
    }
  }
);

export const jkproxyStarter = onRequest(
  { region: "asia-northeast3" },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    try {
      const qs = new URLSearchParams(req.query as Record<string, string>).toString();
      const targetUrl = `https://www.jobkorea.co.kr/Service_JK/Data/JK_Starter_XML_List.asp?${qs}`;
      logger.info("[jkproxyStarter] 요청:", targetUrl);
      const xml = await makeProxy(targetUrl);
      res.set("Content-Type", "application/xml; charset=utf-8");
      res.status(200).send(xml);
    } catch (err) {
      logger.error("[jkproxyStarter] 오류:", err);
      res.status(500).send("API 호출 실패: " + String(err));
    }
  }
);

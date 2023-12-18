import { doc, getDoc, updateDoc } from "firebase/firestore";
import puppeteer from "puppeteer";
import {} from "dotenv/config";
import { DB } from "./utils/firebase.js";

const delay = (n) => new Promise((r) => setTimeout(r, n * 1000));

async function getAccessToken() {
  const docRef = doc(DB, "franchisees", "clover-z");
  let docSnap = await getDoc(docRef);
  let currDeviceCode;

  if (docSnap.exists()) currDeviceCode = docSnap.data()?.deviceCode;

  const TOKEN_URL = `https://authz.constantcontact.com/oauth2/default/v1/token?client_id=${process.env.CTCT_API_KEY}&device_code=${currDeviceCode}&grant_type=urn:ietf:params:oauth:grant-type:device_code`;
  let result;

  // Fetch an access token
  await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  })
    .then((response) => response.json())
    .then((json) => {
      if (json.error) {
        // If the JSON has an error key, the device code has expired and a new one must be retrieved.
        console.log("Fetching a new device code...");
        getDeviceCode();
      } else {
        // Otherwise, the device code is still valid.
        result = json;
      }
    })
    .catch((err) => console.error(err));

  async function getDeviceCode() {
    const AUTH_URL = `https://authz.constantcontact.com/oauth2/default/v1/device/authorize?client_id=${process.env.CTCT_API_KEY}&response_type=code&scope=contact_data%20campaign_data%20offline_access&state=j4m4l`;

    await fetch(AUTH_URL, { method: "POST" })
      .then((response) => response.json())
      .then((json) => {
        const [newDeviceCode, userCode, uri] = [
          json.device_code,
          json.user_code,
          json.verification_uri_complete,
        ];

        // Update Firestore with the newly retrieved device code.
        updateDoc(docRef, {
          deviceCode: newDeviceCode,
        })
          .then(() => {
            console.log(
              `New device code: ${newDeviceCode}\nFollowing the "verification_uri_complete" link (${uri}) to authenticate the device...`
            );
            // Use puppeteer to follow the verification_uri_complete link and verify the device.
            verifyDevice(
              uri,
              userCode,
              "jamal.riley@mathnasium.com",
              process.env.CTCT_PWD
            )
              .then((res) => {
                // After completing this process, retry the parent function.
                console.log(
                  "Device verified. Re-fetching guardians to nudge..."
                );
                if (res) getEmailClicks(CAMPAIGNS);
              })
              .catch((err) => {
                console.error(err);
                process.exit(1);
              });
          })
          .catch((err) =>
            console.log(`Device code update unsuccessful ➔ ${err}`)
          );
      })
      .catch((err) => console.error(err));
  }
  async function getVerificationCode(page, attempts = 0) {
    if (attempts === 5) {
      console.error("Maximum attempts exceeded.");
      return;
    }
    if (page.url().includes("signin/verify/okta/sms")) {
      await delay(60); // The maximum amount of time needed to wait for a new verification code to be sent to Firestore.
      docSnap = await getDoc(docRef);
      let verificationCode;

      if (docSnap.exists()) {
        verificationCode = docSnap.data()?.verificationCode;
      }
      if (verificationCode) {
        await console.log("Verification code receved.");
        await page.keyboard.type(verificationCode, { delay: 125 });
        await delay(5);
        await page.keyboard.press("Enter");
        await delay(10);
        for (let i = 0; i < 60; i++) {
          delay(1);
          if (page.url().includes("device-activate-complete")) {
            break;
          }
        }
        return page.url().includes("device-activate-complete");
      } else {
        getVerificationCode(page, attempts + 1);
      }
    }
  }
  async function verifyDevice(uri, userCode, username, password) {
    return new Promise(async (resolve, reject) => {
      const browser = await puppeteer.launch({
        headless: "new",
      });
      const page = await browser.newPage();
      await page.goto(uri);
      await page.keyboard.press("Tab");
      await delay(5);
      for (let i = 0; i < userCode.length; i++) {
        await page.keyboard.press("ArrowRight");
      }
      await delay(2.5);
      await page.keyboard.press("Enter");
      await delay(5);
      await console.log("Entering login credentials...");
      await page.keyboard.type(username, { delay: 125 });
      await delay(2.5);
      await page.keyboard.press("Enter");
      await delay(10);
      await page.keyboard.type(password, { delay: 125 });
      await delay(2.5);
      await page.keyboard.press("Enter");
      await delay(5);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await console.log("Verification code sent...");
      await delay(2.5);
      const isSuccess = await getVerificationCode(page, 0);
      await browser.close();

      if (isSuccess) resolve(isSuccess);
      else reject(isSuccess);
    });
  }
  return (
    result && {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
    }
  );
}

async function getEmailClicks(campaigns) {
  const ACCESS_TOKEN = (await getAccessToken())?.accessToken;
  if (!ACCESS_TOKEN) return;
  let result = {};

  for (const campaign of campaigns) {
    const URL = `https://api.cc.email/v3/reports/email_reports/${campaign.id}/tracking/clicks`;
    const UNIQUE_GUARDIANS = new Set();

    await fetch(URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((json) => {
        // console.log(json); // All leads
        const CLICKS = json.tracking_activities;
        if (!CLICKS || CLICKS.length === 0) {
          console.log(`${campaign.name}: No clicks found in this campaign`);
          return;
        }

        for (const CLICK of CLICKS) {
          if (
            VALID_LINKS.length === 0 ||
            VALID_LINKS.indexOf(CLICK.link_url) !== -1
          ) {
            UNIQUE_GUARDIANS.add(CLICK.email_address);
          }
        }

        const VALID_GUARDIANS = Array.from(UNIQUE_GUARDIANS);
        console.log("Guardians to nudge:", VALID_GUARDIANS);
        result[campaign.id] = VALID_GUARDIANS;
      });
  }

  console.log("Guardians to nudge:", result);
  return result;
}

const CAMPAIGNS = [
  {
    center: "La Grange",
    id: "59b43a11-f083-4867-9e8b-d6a125174ff4",
    name: "LG Leads: Report Card Season Promo Email #3 (3 days left)",
    textMessage: "Hello, World!",
  },
];
const VALID_LINKS = ["https://rebrand.ly/lagrange-special"];
getEmailClicks(CAMPAIGNS);

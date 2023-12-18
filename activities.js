import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { DB } from "./utils/firebase.js";
import { delay, showElapsedTime } from "./utils/helpers.js";
import { launchPuppeteer } from "./utils/puppeteer.js";
import {
  RADIUS_INFO,
  USERNAME,
  USERNAMES,
  loadActivities,
  logIntoRadius,
} from "./utils/radius.js";

async function fetchSingleOrgActivities(
  iterationCount,
  page,
  franchisee,
  directoryName
) {
  async function reloadActivities(page) {
    await page.click("#btnsearch");
    await page.waitForSelector(".k-master-row");
    await delay(5);
  }
  async function uploadToFirebase(page, franchisee, directoryName) {
    function sortEvents(arr) {
      if (!arr || arr.length === 0) return [];
      const newArr = [];
      for (const unorderedObj of arr) {
        const orderedObj = Object.keys(unorderedObj)
          .sort()
          .reduce((obj, key) => {
            if (key === "dueDate") obj[key] = new Date(unorderedObj[key]);
            else obj[key] = unorderedObj[key];
            return obj;
          }, {});
        newArr.push(orderedObj);
      }

      return newArr.sort(
        (a, b) =>
          a.dueDate - b.dueDate ||
          a.subject.localeCompare(b.subject) ||
          a.contact.localeCompare(b.contact) ||
          a.center.localeCompare(b.center)
      );
    }

    const results = [];
    const rawResults = await page.$$eval(".k-master-row", (rows) => {
      return rows.map((row) => {
        const rowNodes = row.childNodes;

        return {
          contact: rowNodes[0].textContent,
          subject: rowNodes[2].textContent,
          comments: rowNodes[3].textContent,
          // contactPhone: rowNodes[4].textContent,
          // contactEmail: rowNodes[5].textContent,
          dueDate: rowNodes[8].textContent,
          center: rowNodes[10].textContent,
        };
      });
    });
    const data = [...rawResults.slice(100)];
    const filteredData = data.filter(
      (activity) =>
        activity.subject.toUpperCase().includes("[FT]") ||
        activity.subject.toUpperCase().includes("[FT}") ||
        activity.subject.toUpperCase().includes("{FT}") ||
        activity.subject.toUpperCase().includes("{FT]") ||
        activity.subject.toUpperCase().includes("[ASMT]") ||
        activity.subject.toUpperCase().includes("[ASMT}") ||
        activity.subject.toUpperCase().includes("{ASMT}") ||
        activity.subject.toUpperCase().includes("{ASMT]") ||
        activity.subject.toUpperCase().includes("[ASMNT]") ||
        activity.subject.toUpperCase().includes("[ASMNT}") ||
        activity.subject.toUpperCase().includes("{ASMNT}") ||
        activity.subject.toUpperCase().includes("{ASMNT]")
    );
    results.push(...filteredData);

    if (filteredData.length > 0) {
      await process.stdout.write(
        `\n${franchisee}: ${filteredData.length} event${
          filteredData.length === 1 ? "" : "s"
        } successfully captured.`
      );
      const docRef = doc(DB, "franchisees", directoryName);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        const events = data?.events;
        if (
          JSON.stringify(sortEvents(events)) !==
          JSON.stringify(sortEvents(results))
        ) {
          await process.stdout.write(" Updating database... ");
          await updateDoc(docRef, {
            lastUpdated: new Date(),
            events: results,
            eventCount: results.length,
          })
            .then(() => process.stdout.write(" Document updated successfully!"))
            .catch((err) =>
              process.stdout.write(`Data upload unsuccessful ➔ ${err}`)
            );
        } else {
          await process.stdout.write(" No new changes detected.");
        }
      } else {
        await setDoc(docRef, {
          lastUpdated: new Date(),
          events: results,
          eventCount: results.length,
        })
          .then(() => process.stdout.write(" Document added successfully!"))
          .catch((err) =>
            process.stdout.write(`Data upload unsuccessful ➔ ${err}`)
          );
      }
    } else {
      // Send alert
    }
  }
  try {
    if (iterationCount > 1) await reloadActivities(page); // Only execute this function reload activities after the first iteration since the first iteration loads the activities upon startup.
    await uploadToFirebase(page, franchisee, directoryName);
  } catch (err) {
    console.error(`\n${err}`);
  }
}

(async () => {
  let runtime = process.argv[2]; // Measured in hours
  let updateInterval = 1; // Measured in minutes, Number(process.argv[3]);
  const [minRuntime, maxRuntime] = [0, 168];

  if (
    process.argv.length === 2 ||
    Number(runtime) < minRuntime ||
    Number(runtime) > maxRuntime ||
    (isNaN(runtime) && runtime !== "endless")
  ) {
    console.error(
      `Please enter a number between ${minRuntime} and ${maxRuntime}. This is the total runtime, measured in hours. If 0 is entered, the function will execute only once. If "endless" is entered, the function will execute until it is manually stopped.`
    );
    process.exit(1);
  } else if (runtime === "endless") {
    console.warn(
      "WARNING: This function will run endlessly until it is manually stopped.\n"
    );
  }

  const [startH, startM, startS] = [0, 0, 0];
  const startVal = startS + 60 * startM + 3600 * startH;
  const runtimeSeconds = 60 * 60 * Number(runtime);

  if (USERNAMES.length === 0) return;
  else if (USERNAMES.length === 1) {
    let count = 0;

    const page = await launchPuppeteer();
    await logIntoRadius(page, USERNAME, RADIUS_INFO.get(USERNAME).franchisee);
    await loadActivities(page, RADIUS_INFO.get(USERNAME).hasTextingEnabled);

    for (
      let i = startVal;
      runtime === "endless" ? i < Infinity : i <= runtimeSeconds;
      i++
    ) {
      if (i % (60 * updateInterval) === 0) {
        await process.stdout.write("\r\x1b[K");
        await process.stdout.write(
          `${showElapsedTime(
            i
          )} ➔ Fetching Radius events. This should take a few seconds!`
        );
        count++;
        const start = Date.now();
        let successMsg;

        try {
          await fetchSingleOrgActivities(
            count,
            page,
            RADIUS_INFO.get(USERNAME).franchisee,
            RADIUS_INFO.get(USERNAME).directoryName
          );
          successMsg = "Radius automation successful.";
        } catch (err) {
          await process.stdout.write(`\n${err.message}`);
          successMsg = "Radius automation unsuccessful.";
        }

        const end = Date.now();
        const duration = Math.round((end - start) / 1000);
        i += duration;
        await process.stdout.write(
          `\n${successMsg} Execution time: ${duration}s\n\n`
        );
      } else {
        await process.stdout.write("\r\x1b[K");
        await process.stdout.write(showElapsedTime(i));
        await delay(1);
      }
    }
  }

  process.exit(1);
})();

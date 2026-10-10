import test from "node:test";
import assert from "node:assert/strict";
import { homepageInterests, homepageIntro } from "./home-intro.js";

test("testHomepageUsesWempoIntroVerbatim", () => {
  assert.equal(
    homepageIntro,
    "Hi i'm ItsWempo. Im just a goober trying to have fun on both Polytoria and Roblox. I love myself some funny stuff and i forum alot. I sometimes play games but i forum a lot and you prob know me by now (if not then i'll change that:3). My username on Roblox is same as polytoria btw:3 Bye!!!",
  );
});

test("testHomepageHighlightsWempoInterests", () => {
  assert.deepEqual(homepageInterests, ["Polytoria", "Roblox", "funny stuff", "forums"]);
});

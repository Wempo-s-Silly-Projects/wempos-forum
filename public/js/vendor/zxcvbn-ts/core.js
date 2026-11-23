this.zxcvbnts = this.zxcvbnts || {};
this.zxcvbnts.core = (function (exports) {
    'use strict';

    const extend = (listToExtend, list) => {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < list.length; i += 1) {
        listToExtend.push(list[i]);
      }
    };
    const SURROGATE_PAIR = /[\ud800-\udbff][\udc00-\udfff]/g;
    // the first UTF-16 code unit of a character outside the BMP (eg. an emoji)
    const isHighSurrogate = code => code >= 0xd800 && code <= 0xdbff;
    const isLowSurrogate = code => code >= 0xdc00 && code <= 0xdfff;
    // a surrogate pair, one character in two code units, starts at index
    const isSurrogatePairAt = (string, index) => isHighSurrogate(string.charCodeAt(index)) && isLowSurrogate(string.charCodeAt(index + 1));
    // count characters by Unicode code point rather than UTF-16 code unit, so a
    // surrogate pair (eg. an emoji) counts as one character instead of two.
    // Same result as Array.from(string).length without building the array.
    // Match indices [i, j] stay in UTF-16 code units, this is only for counting.
    const countCharacters = string => {
      var _a, _b;
      return string.length - ((_b = (_a = string.match(SURROGATE_PAIR)) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0);
    };
    // dictionary names get a suffix like `diceware-common`, so `name` covers
    // `name` and `name-<suffix>`. Runs for every dictionary match, so it compares
    // without building `${name}-`
    const isDictionaryNamed = (dictionaryName, name) => dictionaryName.startsWith(name) && (dictionaryName.length === name.length || dictionaryName[name.length] === '-');
    // lowercase without changing the length, so match indices [i, j] point at the
    // same characters in the password and its lowercase form.
    // 'İ' (U+0130) is the only character whose lowercase form is longer ('i' plus
    // a combining dot), so map it to 'i' like the dictionaries spell it.
    // Use this everywhere text is lowercased to be compared with dictionary words.
    const toLowerCase = string => string.replace(/İ/g, 'i').toLowerCase();

    var dateSplits = {
      4: [
      // for length-4 strings, eg 1191 or 9111, two ways to split:
      [1, 2],
      // 1 1 91 (2nd split starts at index 1, 3rd at index 2)
      [2, 3] // 91 1 1
      ],
      5: [[1, 3],
      // 1 11 91
      [2, 3],
      // 11 1 91
      //  [2, 3], // 91 1 11    <- duplicate previous one
      [2, 4] // 91 11 1    <- New and must be added as bug fix
      ],
      6: [[1, 2],
      // 1 1 1991
      [2, 4],
      // 11 11 91
      [4, 5] // 1991 1 1
      ],
      //  1111991
      7: [[1, 3],
      // 1 11 1991
      [2, 3],
      // 11 1 1991
      [4, 5],
      // 1991 1 11
      [4, 6] // 1991 11 1
      ],
      8: [[2, 4],
      // 11 11 1991
      [4, 6] // 1991 11 11
      ]
    };

    const DATE_MAX_YEAR = 2099;
    const DATE_MIN_YEAR = 1000;
    const DATE_SPLITS = dateSplits;
    const BRUTEFORCE_CARDINALITY = 10;
    const MIN_GUESSES_BEFORE_GROWING_SEQUENCE = 10000;
    const MIN_SUBMATCH_GUESSES_SINGLE_CHAR = 10;
    const MIN_SUBMATCH_GUESSES_MULTI_CHAR = 50;
    const MIN_YEAR_SPACE = 21;
    // \xbf-\xdf is a range for almost all special uppercase letter like Ä and so on
    const START_UPPER = /^[A-Z\xbf-\xdf][^A-Z\xbf-\xdf]+$/;
    const END_UPPER = /^[^A-Z\xbf-\xdf]+[A-Z\xbf-\xdf]$/;
    // \xdf-\xff is a range for almost all special lowercase letter like ä and so on
    const ALL_UPPER = /^[A-Z\xbf-\xdf]+$/;
    const ALL_UPPER_INVERTED = /^[^a-z\xdf-\xff]+$/;
    const ALL_LOWER = /^[a-z\xdf-\xff]+$/;
    const ALL_LOWER_INVERTED = /^[^A-Z\xbf-\xdf]+$/;
    const ONE_LOWER = /[a-z\xdf-\xff]/;
    const ONE_UPPER = /[A-Z\xbf-\xdf]/;
    const ALPHA_INVERTED = /[^A-Za-z\xbf-\xdf]/gi;
    const ALL_DIGIT = /^\d+$/;
    const REFERENCE_YEAR = new Date().getFullYear();
    const REGEXEN = {
      recentYear: /19\d\d|20\d\d/g
    };
    /* Separators */
    // what the separator matcher splits a password at, eg. 'pass;word|123'.
    // Its length is what a separator match is charged
    const SEPARATOR_CHARS = [' ', ',', ';', ':', '|', '/', '\\', '_', '.', '-'];
    const SEPARATOR_CHAR_COUNT = SEPARATOR_CHARS.length;
    /* Word sequences */
    // the subset of SEPARATOR_CHARS that joins words into one name or phrase:
    // 'one two', 'one-two', 'one_two', 'one.two'. Its size is what each gap of a
    // word sequence is charged, so adding a character here raises those guesses
    const WORD_SEQUENCE_SEPARATOR_CHARS = new Set([' ', '-', '_', '.']);
    const WORD_SEQUENCE_LETTER_GAP_OPTIONS = 26;
    const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

    class MatcherBaseClass {
      constructor(options) {
        this.options = options;
      }
    }

    /*
     * -------------------------------------------------------------------------------
     *  date matching ----------------------------------------------------------------
     * -------------------------------------------------------------------------------
     */
    class MatchDate extends MatcherBaseClass {
      /*
       * a "date" is recognized as:
       *   any 3-tuple that starts or ends with a 2- or 4-digit year,
       *   with 2 or 0 separator chars (1.1.91 or 1191),
       *   maybe zero-padded (01-01-91 vs 1-1-91),
       *   a month between 1 and 12,
       *   a day between 1 and 31.
       *
       * note: this isn't true date parsing in that "feb 31st" is allowed,
       * this doesn't check for leap years, etc.
       *
       * recipe:
       * start with regex to find maybe-dates, then attempt to map the integers
       * onto month-day-year to filter the maybe-dates into dates.
       * finally, remove matches that are substrings of other matches to reduce noise.
       *
       * note: instead of using a lazy or greedy regex to find many dates over the full string,
       * this uses a ^...$ regex against every substring of the password -- less performant but leads
       * to every possible date match.
       */
      match({
        password
      }) {
        const matches = [...this.getMatchesWithoutSeparator(password), ...this.getMatchesWithSeparator(password)];
        const filteredMatches = this.filterNoise(matches);
        return filteredMatches;
      }
      getMatchesWithSeparator(password) {
        const matches = [];
        const maybeDateWithSeparator = /^(\d{1,4})([\s/\\_.-])(\d{1,2})\2(\d{1,4})$/;
        // # dates with separators are between length 6 '1/1/91' and 10 '11/11/1991'
        for (let i = 0; i <= Math.abs(password.length - 6); i += 1) {
          for (let j = i + 5; j <= i + 9; j += 1) {
            if (j >= password.length) {
              break;
            }
            const token = password.slice(i, j + 1);
            const regexMatch = maybeDateWithSeparator.exec(token);
            if (regexMatch != null) {
              const dmy = this.mapIntegersToDayMonthYear([parseInt(regexMatch[1], 10), parseInt(regexMatch[3], 10), parseInt(regexMatch[4], 10)]);
              if (dmy != null) {
                matches.push({
                  pattern: 'date',
                  token,
                  i,
                  j,
                  separator: regexMatch[2],
                  year: dmy.year,
                  month: dmy.month,
                  day: dmy.day
                });
              }
            }
          }
        }
        return matches;
      }
      // eslint-disable-next-line max-statements
      getMatchesWithoutSeparator(password) {
        const matches = [];
        const maybeDateNoSeparator = /^\d{4,8}$/;
        const metric = candidate => Math.abs(candidate.year - REFERENCE_YEAR);
        // # dates without separators are between length 4 '1191' and 8 '11111991'
        for (let i = 0; i <= Math.abs(password.length - 4); i += 1) {
          for (let j = i + 3; j <= i + 7; j += 1) {
            if (j >= password.length) {
              break;
            }
            const token = password.slice(i, j + 1);
            if (maybeDateNoSeparator.exec(token)) {
              const candidates = [];
              const index = token.length;
              const splittedDates = DATE_SPLITS[index];
              splittedDates.forEach(([k, l]) => {
                const dmy = this.mapIntegersToDayMonthYear([parseInt(token.slice(0, k), 10), parseInt(token.slice(k, l), 10), parseInt(token.slice(l), 10)]);
                if (dmy != null) {
                  candidates.push(dmy);
                }
              });
              if (candidates.length > 0) {
                /*
                 * at this point: different possible dmy mappings for the same i,j substring.
                 * match the candidate date that likely takes the fewest guesses: a year closest
                 * to 2000.
                 * (scoring.REFERENCE_YEAR).
                 *
                 * ie, considering '111504', prefer 11-15-04 to 1-1-1504
                 * (interpreting '04' as 2004)
                 */
                let bestCandidate = candidates[0];
                let minDistance = metric(candidates[0]);
                candidates.slice(1).forEach(candidate => {
                  const distance = metric(candidate);
                  if (distance < minDistance) {
                    bestCandidate = candidate;
                    minDistance = distance;
                  }
                });
                matches.push({
                  pattern: 'date',
                  token,
                  i,
                  j,
                  separator: '',
                  year: bestCandidate.year,
                  month: bestCandidate.month,
                  day: bestCandidate.day
                });
              }
            }
          }
        }
        return matches;
      }
      /*
       * matches now contains all valid date strings in a way that is tricky to capture
       * with regexes only. while thorough, it will contain some unintuitive noise:
       *
       * '2015_06_04', in addition to matching 2015_06_04, will also contain
       * 5(!) other date matches: 15_06_04, 5_06_04, ..., even 2015 (matched as 5/1/2020)
       *
       * to reduce noise, remove date matches that are strict substrings of others
       */
      filterNoise(matches) {
        if (matches.length === 0) {
          return [];
        }
        const sortedMatches = [...matches].sort((a, b) => {
          if (a.i !== b.i) {
            return a.i - b.i;
          }
          return b.j - a.j;
        });
        const result = [];
        let maxJ = -1;
        for (const match of sortedMatches) {
          if (match.j > maxJ) {
            result.push(match);
            maxJ = match.j;
          }
        }
        return result;
      }
      /*
       * given a 3-tuple, discard if:
       *   middle int is over 31 (for all dmy formats, years are never allowed in the middle)
       *   middle int is zero
       *   any int is over the max allowable year
       *   any int is over two digits but under the min allowable year
       *   2 integers are over 31, the max allowable day
       *   2 integers are zero
       *   all integers are over 12, the max allowable month
       */
      // eslint-disable-next-line complexity, max-statements
      mapIntegersToDayMonthYear(integers) {
        if (integers[1] > 31 || integers[1] <= 0) {
          return null;
        }
        let over12 = 0;
        let over31 = 0;
        let under1 = 0;
        for (let o = 0, len1 = integers.length; o < len1; o += 1) {
          const int = integers[o];
          if (int > 99 && int < DATE_MIN_YEAR || int > DATE_MAX_YEAR) {
            return null;
          }
          if (int > 31) {
            over31 += 1;
          }
          if (int > 12) {
            over12 += 1;
          }
          if (int <= 0) {
            under1 += 1;
          }
        }
        if (over31 >= 2 || over12 === 3 || under1 >= 2) {
          return null;
        }
        return this.getDayMonth(integers);
      }
      // eslint-disable-next-line max-statements
      getDayMonth(integers) {
        // first look for a four digit year: yyyy + daymonth or daymonth + yyyy
        const possibleYearSplits = [[integers[2], integers.slice(0, 2)],
        // year last
        [integers[0], integers.slice(1, 3)] // year first
        ];
        const possibleYearSplitsLength = possibleYearSplits.length;
        for (let j = 0; j < possibleYearSplitsLength; j += 1) {
          const [y, rest] = possibleYearSplits[j];
          if (DATE_MIN_YEAR <= y && y <= DATE_MAX_YEAR) {
            const dm = this.mapIntegersToDayMonth(rest);
            if (dm != null) {
              return {
                year: y,
                month: dm.month,
                day: dm.day
              };
            }
            /*
             * for a candidate that includes a four-digit year,
             * when the remaining integers don't match to a day and month,
             * it is not a date.
             */
            return null;
          }
        }
        // given no four-digit year, two digit years are the most flexible int to match, so
        // try to parse a day-month out of integers[0..1] or integers[1..0]
        for (let k = 0; k < possibleYearSplitsLength; k += 1) {
          const [y, rest] = possibleYearSplits[k];
          const dm = this.mapIntegersToDayMonth(rest);
          if (dm != null) {
            return {
              year: this.twoToFourDigitYear(y),
              month: dm.month,
              day: dm.day
            };
          }
        }
        return null;
      }
      mapIntegersToDayMonth(integers) {
        const temp = [integers, integers.slice().reverse()];
        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < temp.length; i += 1) {
          const data = temp[i];
          const day = data[0];
          const month = data[1];
          if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
            return {
              day,
              month
            };
          }
        }
        return null;
      }
      twoToFourDigitYear(year) {
        if (year > 50) {
          // 87 -> 1987
          return year + 1900;
        }
        // 15 -> 2015
        return year + 2000;
      }
    }

    const peq = new Uint32Array(0x10000);
    const myers_32 = (a, b) => {
        const n = a.length;
        const m = b.length;
        const lst = 1 << (n - 1);
        let pv = -1;
        let mv = 0;
        let sc = n;
        let i = n;
        while (i--) {
            peq[a.charCodeAt(i)] |= 1 << i;
        }
        for (i = 0; i < m; i++) {
            let eq = peq[b.charCodeAt(i)];
            const xv = eq | mv;
            eq |= ((eq & pv) + pv) ^ pv;
            mv |= ~(eq | pv);
            pv &= eq;
            if (mv & lst) {
                sc++;
            }
            if (pv & lst) {
                sc--;
            }
            mv = (mv << 1) | 1;
            pv = (pv << 1) | ~(xv | mv);
            mv &= xv;
        }
        i = n;
        while (i--) {
            peq[a.charCodeAt(i)] = 0;
        }
        return sc;
    };
    const myers_x = (b, a) => {
        const n = a.length;
        const m = b.length;
        const mhc = [];
        const phc = [];
        const hsize = Math.ceil(n / 32);
        const vsize = Math.ceil(m / 32);
        for (let i = 0; i < hsize; i++) {
            phc[i] = -1;
            mhc[i] = 0;
        }
        let j = 0;
        for (; j < vsize - 1; j++) {
            let mv = 0;
            let pv = -1;
            const start = j * 32;
            const vlen = Math.min(32, m) + start;
            for (let k = start; k < vlen; k++) {
                peq[b.charCodeAt(k)] |= 1 << k;
            }
            for (let i = 0; i < n; i++) {
                const eq = peq[a.charCodeAt(i)];
                const pb = (phc[(i / 32) | 0] >>> i) & 1;
                const mb = (mhc[(i / 32) | 0] >>> i) & 1;
                const xv = eq | mv;
                const xh = ((((eq | mb) & pv) + pv) ^ pv) | eq | mb;
                let ph = mv | ~(xh | pv);
                let mh = pv & xh;
                if ((ph >>> 31) ^ pb) {
                    phc[(i / 32) | 0] ^= 1 << i;
                }
                if ((mh >>> 31) ^ mb) {
                    mhc[(i / 32) | 0] ^= 1 << i;
                }
                ph = (ph << 1) | pb;
                mh = (mh << 1) | mb;
                pv = mh | ~(xv | ph);
                mv = ph & xv;
            }
            for (let k = start; k < vlen; k++) {
                peq[b.charCodeAt(k)] = 0;
            }
        }
        let mv = 0;
        let pv = -1;
        const start = j * 32;
        const vlen = Math.min(32, m - start) + start;
        for (let k = start; k < vlen; k++) {
            peq[b.charCodeAt(k)] |= 1 << k;
        }
        let score = m;
        for (let i = 0; i < n; i++) {
            const eq = peq[a.charCodeAt(i)];
            const pb = (phc[(i / 32) | 0] >>> i) & 1;
            const mb = (mhc[(i / 32) | 0] >>> i) & 1;
            const xv = eq | mv;
            const xh = ((((eq | mb) & pv) + pv) ^ pv) | eq | mb;
            let ph = mv | ~(xh | pv);
            let mh = pv & xh;
            score += (ph >>> (m - 1)) & 1;
            score -= (mh >>> (m - 1)) & 1;
            if ((ph >>> 31) ^ pb) {
                phc[(i / 32) | 0] ^= 1 << i;
            }
            if ((mh >>> 31) ^ mb) {
                mhc[(i / 32) | 0] ^= 1 << i;
            }
            ph = (ph << 1) | pb;
            mh = (mh << 1) | mb;
            pv = mh | ~(xv | ph);
            mv = ph & xv;
        }
        for (let k = start; k < vlen; k++) {
            peq[b.charCodeAt(k)] = 0;
        }
        return score;
    };
    const distance = (a, b) => {
        if (a.length < b.length) {
            const tmp = b;
            b = a;
            a = tmp;
        }
        if (b.length === 0) {
            return a.length;
        }
        if (a.length <= 32) {
            return myers_32(a, b);
        }
        return myers_x(a, b);
    };

    // fastest-levenshtein compares UTF-16 code units, which would count a
    // character outside the BMP (eg. an emoji) as two edits. Such a character of
    // the password is replaced with this one code unit instead, a noncharacter
    // that doesn't match anything in an entry without it.
    const PLACEHOLDER = '\uffff';
    // for an entry with characters outside the BMP, or the placeholder
    const codePointDistance = (first, second) => {
      let previousRow = Array.from({
        length: second.length + 1
      }, (_, index) => index);
      first.forEach((firstCharacter, firstIndex) => {
        const row = [firstIndex + 1];
        second.forEach((secondCharacter, secondIndex) => {
          row.push(Math.min(previousRow[secondIndex + 1] + 1, row[secondIndex] + 1, previousRow[secondIndex] + (firstCharacter === secondCharacter ? 0 : 1)));
        });
        previousRow = row;
      });
      return previousRow[second.length];
    };
    // the distance between the password and an entry of entryLength characters
    const createGetDistance = password => {
      const passwordCharacters = Array.from(password);
      const hasSurrogatePairs = password.length !== passwordCharacters.length;
      const passwordCodeUnits = hasSurrogatePairs ? passwordCharacters.map(character => character.length > 1 ? PLACEHOLDER : character).join('') : password;
      return (entry, entryLength) => entry.length === entryLength && !(hasSurrogatePairs && entry.includes(PLACEHOLDER)) ? distance(passwordCodeUnits, entry) : codePointDistance(passwordCharacters, Array.from(entry));
    };
    // A bit for each character (code point) a string contains, several characters
    // share a bit. Each character only one of two strings contains takes an edit,
    // so comparing their masks rules out most entries without the distance.
    // 30 bits keep the values small integers, with 32 V8 runs the bit operations
    // slower than the distance itself.
    const getCharacterMask = string => {
      let mask = 0;
      for (let index = 0; index < string.length; index += 1) {
        const code = string.charCodeAt(index);
        // skip the high surrogate, so an emoji only sets the bit of its low one
        if (!isHighSurrogate(code)) {
          mask |= 1 << code % 30;
        }
      }
      return mask;
    };
    // more than limit bits of value are set
    const hasMoreBits = (value, limit) => {
      let rest = value;
      for (let count = 0; count < limit; count += 1) {
        // clear the lowest set bit
        rest &= rest - 1;
      }
      return rest !== 0;
    };
    // An entry can only be within the threshold if its length is close to the
    // password's, so group the entries by length (in characters, an emoji counts
    // as one) and only check those groups.
    // Building this means listing every entry, which is expensive for large
    // dictionaries. Dictionaries never change after they are built, so do it once
    // per object.
    const entriesByLengthCache = new WeakMap();
    // a dictionary lists its entries in any order, so the entries of a group
    // aren't always in rank order
    const sortByRank = group => {
      const {
        entries,
        ranks
      } = group;
      if (ranks.every((rank, index) => index === 0 || ranks[index - 1] <= rank)) {
        return;
      }
      const order = ranks.map((_, index) => index).sort((first, second) => ranks[first] - ranks[second]);
      group.entries = order.map(index => entries[index]);
      group.ranks = order.map(index => ranks[index]);
    };
    const getEntriesByLength = dictionary => {
      const cached = entriesByLengthCache.get(dictionary);
      if (cached) {
        return cached;
      }
      const entriesByLength = new Map();
      const {
        entries,
        ranks
      } = dictionary.getEntries();
      entries.forEach((entry, index) => {
        // an empty entry (eg. from an empty user input) is never a match
        if (entry === '') {
          return;
        }
        const length = countCharacters(entry);
        let group = entriesByLength.get(length);
        if (!group) {
          group = {
            entries: [],
            ranks: [],
            masks: new Int32Array(0)
          };
          entriesByLength.set(length, group);
        }
        group.entries.push(entry);
        group.ranks.push(ranks[index]);
      });
      entriesByLength.forEach(group => {
        sortByRank(group);
        group.masks = Int32Array.from(group.entries, getCharacterMask);
      });
      entriesByLengthCache.set(dictionary, entriesByLength);
      return entriesByLength;
    };
    // the most common entry wins, so only an entry ranked before the one already
    // found can replace it
    const findInGroup = ({
      group: {
        entries,
        ranks,
        masks
      },
      entryLength,
      threshold,
      getDistance,
      passwordMask,
      found
    }) => {
      // a larger threshold than the bits of a mask can't rule out an entry
      const maxDifferentCharacters = Math.min(Math.floor(threshold), 30);
      const foundRank = found ? found.rank : Infinity;
      for (let index = 0; index < entries.length && ranks[index] < foundRank; index += 1) {
        const mask = masks[index];
        if (hasMoreBits(mask & ~passwordMask, maxDifferentCharacters) || hasMoreBits(passwordMask & ~mask, maxDifferentCharacters)) {
          continue;
        }
        const entryDistance = getDistance(entries[index], entryLength);
        if (entryDistance <= threshold) {
          return {
            rank: ranks[index],
            entry: entries[index],
            distance: entryDistance
          };
        }
      }
      return found;
    };
    // The most common entry within the threshold, the password itself (with
    // passwordRank, its rank in the dictionary) unless a more common entry is
    // close to it
    const findLevenshteinEntry = (password, dictionary, threshold, passwordRank) => {
      const entriesByLength = getEntriesByLength(dictionary);
      const passwordLength = countCharacters(password);
      const getDistance = createGetDistance(password);
      const passwordMask = getCharacterMask(password);
      let found = passwordRank === undefined ? undefined : {
        rank: passwordRank,
        entry: password,
        distance: 0
      };
      const lengthDifference = entryLength => Math.abs(entryLength - passwordLength);
      // An entry is at least as many edits away as the lengths differ, so only
      // check the lengths within the threshold. Closest first, where a typo most
      // likely is, so a common entry found early lets the others skip more.
      Array.from(entriesByLength.keys()).filter(entryLength => lengthDifference(entryLength) <= threshold).sort((first, second) => lengthDifference(first) - lengthDifference(second)).forEach(entryLength => {
        found = findInGroup({
          group: entriesByLength.get(entryLength),
          entryLength,
          threshold,
          getDistance,
          passwordMask,
          found
        });
      });
      return found;
    };

    // The words that start with a prefix, in the word index and in the user
    // inputs. Plain and l33t dictionary matching extend a prefix with it one
    // character at a time.
    class WordRanges {
      constructor(wordIndex, userInputsWordIndex) {
        this.wordIndex = wordIndex;
        this.userInputsWordIndex = userInputsWordIndex;
        this.range = new Int32Array(2);
        this.userInputsRange = new Int32Array(2);
      }
      // all words, the empty prefix
      reset() {
        this.range[0] = 0;
        this.range[1] = this.wordIndex.words.length;
        this.userInputsRange[0] = 0;
        this.userInputsRange[1] = this.userInputsWordIndex ? this.userInputsWordIndex.words.length : 0;
      }
      copy({
        range,
        userInputsRange
      }) {
        this.range[0] = range[0];
        this.range[1] = range[1];
        this.userInputsRange[0] = userInputsRange[0];
        this.userInputsRange[1] = userInputsRange[1];
      }
      // extends the prefix of depth characters by code, returns the searches it took
      narrow(depth, code) {
        let searches = 0;
        if (this.range[0] < this.range[1]) {
          this.wordIndex.narrow(this.range, depth, code);
          searches += 1;
        }
        if (this.userInputsWordIndex && this.userInputsRange[0] < this.userInputsRange[1]) {
          this.userInputsWordIndex.narrow(this.userInputsRange, depth, code);
          searches += 1;
        }
        return searches;
      }
      // no word starts with the prefix
      isEmpty() {
        return this.range[0] >= this.range[1] && this.userInputsRange[0] >= this.userInputsRange[1];
      }
      // The index in the word index of the word that is the prefix of length
      // characters, or -1. The shortest word of a range comes first.
      getWord(length) {
        return this.range[0] < this.range[1] && this.wordIndex.words[this.range[0]].length === length ? this.range[0] : -1;
      }
      // the rank among the user inputs of the word that is the prefix of length
      // characters, if one
      getUserInputsRank(length) {
        return this.userInputsWordIndex && this.userInputsRange[0] < this.userInputsRange[1] && this.userInputsWordIndex.words[this.userInputsRange[0]].length === length ? this.userInputsWordIndex.getRank(this.userInputsRange[0], 0) : undefined;
      }
      // the word getUserInputsRank found a rank for
      getUserInput() {
        return this.userInputsWordIndex.words[this.userInputsRange[0]];
      }
    }

    const USER_INPUTS = 'userInputs';
    // The position of the user inputs among the dictionaries of wordIndex, the one
    // of the dictionary userInputs, or after the last without it
    const getUserInputsPosition = wordIndex => {
      const position = wordIndex.dictionaryNames.indexOf(USER_INPUTS);
      return position === -1 ? wordIndex.dictionaryNames.length : position;
    };
    // The longest user input in characters
    const userInputsMaxWordSizeCache = new WeakMap();
    const getUserInputsMaxWordSize = userInputsWordIndex => {
      let maxWordSize = userInputsMaxWordSizeCache.get(userInputsWordIndex);
      if (maxWordSize === undefined) {
        maxWordSize = userInputsWordIndex.words.reduce((max, word) => Math.max(max, countCharacters(word)), 0);
        userInputsMaxWordSizeCache.set(userInputsWordIndex, maxWordSize);
      }
      return maxWordSize;
    };
    // the entries of both, an entry of first keeps its rank in first
    const combineLevenshteinDictionaries = (first, second) => ({
      getEntries: () => {
        const {
          entries,
          ranks
        } = first.getEntries();
        const seen = new Set(entries);
        const secondEntries = second.getEntries();
        secondEntries.entries.forEach((entry, index) => {
          if (!seen.has(entry)) {
            entries.push(entry);
            ranks.push(secondEntries.ranks[index]);
          }
        });
        return {
          entries,
          ranks
        };
      },
      getRank: entry => {
        var _a;
        return (_a = first.getRank(entry)) !== null && _a !== void 0 ? _a : second.getRank(entry);
      }
    });
    // The userInputs dictionary of the options with the user inputs on top. Keyed
    // by both word indexes, which are rebuilt whenever their words change.
    const userInputsLevenshteinCache = new WeakMap();
    const getUserInputsLevenshteinDictionary = (wordIndex, userInputsWordIndex) => {
      let byUserInputs = userInputsLevenshteinCache.get(wordIndex);
      if (!byUserInputs) {
        byUserInputs = new WeakMap();
        userInputsLevenshteinCache.set(wordIndex, byUserInputs);
      }
      let dictionary = byUserInputs.get(userInputsWordIndex);
      if (!dictionary) {
        const userInputs = userInputsWordIndex.getLevenshteinDictionary(0);
        const optionsDictionary = wordIndex.dictionaryNames.indexOf(USER_INPUTS);
        dictionary = optionsDictionary === -1 ? userInputs : combineLevenshteinDictionaries(userInputs, wordIndex.getLevenshteinDictionary(optionsDictionary));
        byUserInputs.set(userInputsWordIndex, dictionary);
      }
      return dictionary;
    };
    class MatchDictionary extends MatcherBaseClass {
      // eslint-disable-next-line complexity,max-statements
      match({
        password,
        userInputsOptions
      }) {
        const matches = [];
        const passwordLength = password.length;
        const passwordLower = toLowerCase(password);
        const {
          wordIndex,
          useLevenshteinDistance
        } = this.options;
        const userInputsPosition = getUserInputsPosition(wordIndex);
        const userInputsWordIndex = userInputsOptions === null || userInputsOptions === void 0 ? void 0 : userInputsOptions.wordIndex;
        const addMatches = (i, j, hits) => {
          const usedPassword = passwordLower.slice(i, j + 1);
          hits.forEach(({
            dictionaryName,
            rank,
            ...levenshtein
          }) => {
            matches.push({
              pattern: 'dictionary',
              i,
              j,
              token: password.slice(i, j + 1),
              matchedWord: usedPassword,
              rank,
              dictionaryName,
              reversed: false,
              l33t: false,
              ...levenshtein
            });
          });
        };
        // the words that start with password[i, j], narrowed with each j
        const ranges = new WordRanges(wordIndex, userInputsWordIndex);
        for (let i = 0; i < passwordLength; i += 1) {
          ranges.reset();
          for (let j = i; j < passwordLength; j += 1) {
            const depth = j - i;
            ranges.narrow(depth, passwordLower.charCodeAt(j));
            // no longer word starts with it
            if (ranges.isEmpty()) {
              break;
            }
            // only use levenshtein distance on full password to minimize the performance drop
            // and because otherwise there would be to many false positives
            const isFullPassword = i === 0 && j === passwordLength - 1;
            if (useLevenshteinDistance && isFullPassword) {
              break;
            }
            const word = ranges.getWord(depth + 1);
            const userInputsRank = ranges.getUserInputsRank(depth + 1);
            if (word !== -1 || userInputsRank !== undefined) {
              addMatches(i, j, this.getHits(word, userInputsRank, userInputsPosition));
            }
          }
          // the full password is checked for every dictionary, even if no word starts with it
          if (i === 0 && useLevenshteinDistance) {
            addMatches(0, passwordLength - 1, this.getLevenshteinHits(passwordLower, userInputsWordIndex));
          }
        }
        return matches;
      }
      // The hits of wordIndex.words[word], or -1 for none, in dictionary order.
      // A rank of the user inputs replaces the one of the dictionary userInputs,
      // or comes last without it.
      // eslint-disable-next-line max-statements
      getHits(word, userInputsRank, userInputsDictionary) {
        const {
          wordIndex
        } = this.options;
        const {
          dictionaryNames,
          hitStart,
          hitDictionary,
          hitRank
        } = wordIndex;
        const hits = [];
        let remainingUserInputsRank = userInputsRank;
        if (word !== -1) {
          for (let hit = hitStart[word]; hit < hitStart[word + 1]; hit += 1) {
            const dictionary = hitDictionary[hit];
            if (remainingUserInputsRank !== undefined && dictionary >= userInputsDictionary) {
              hits.push({
                dictionaryName: USER_INPUTS,
                rank: remainingUserInputsRank
              });
              remainingUserInputsRank = undefined;
              if (dictionary === userInputsDictionary) {
                continue;
              }
            }
            hits.push({
              dictionaryName: dictionaryNames[dictionary],
              rank: hitRank[hit]
            });
          }
        }
        if (remainingUserInputsRank !== undefined) {
          hits.push({
            dictionaryName: USER_INPUTS,
            rank: remainingUserInputsRank
          });
        }
        return hits;
      }
      // the hits of the full password in every dictionary, in dictionary order
      getLevenshteinHits(usedPassword, userInputsWordIndex) {
        const {
          wordIndex,
          dictionaryMaxWordSizes,
          levenshteinThreshold
        } = this.options;
        const {
          dictionaryNames
        } = wordIndex;
        const passwordLength = countCharacters(usedPassword);
        const hits = [];
        const addHit = (dictionaryName, dictionary, maxWordSize) => {
          const rank = dictionary.getRank(usedPassword);
          // a more common entry close to the full password beats the password
          // itself, even if the dictionary contains it. A password longer than
          // the dictionary's longest word by more than the threshold is at least
          // that many edits away from every entry.
          const found = passwordLength - maxWordSize > levenshteinThreshold ? undefined : findLevenshteinEntry(usedPassword, dictionary, levenshteinThreshold, rank);
          // finding the password itself is an exact match, not a levenshtein one
          if (found && found.entry !== usedPassword) {
            hits.push({
              dictionaryName: dictionaryName,
              rank: found.rank,
              levenshteinDistance: found.distance,
              levenshteinDistanceEntry: found.entry
            });
          } else if (rank !== undefined) {
            hits.push({
              dictionaryName: dictionaryName,
              rank
            });
          }
        };
        const userInputsDictionary = getUserInputsPosition(wordIndex);
        for (let dictionary = 0; dictionary <= dictionaryNames.length; dictionary += 1) {
          if (dictionary === userInputsDictionary && userInputsWordIndex) {
            addHit(USER_INPUTS, getUserInputsLevenshteinDictionary(wordIndex, userInputsWordIndex), Math.max(getUserInputsMaxWordSize(userInputsWordIndex), dictionaryMaxWordSizes[USER_INPUTS] || 0));
          } else if (dictionary < dictionaryNames.length) {
            const name = dictionaryNames[dictionary];
            addHit(name, wordIndex.getLevenshteinDictionary(dictionary), dictionaryMaxWordSizes[name]);
          }
        }
        return hits;
      }
    }

    class CleanPasswords {
      constructor({
        substr,
        limit,
        trieRoot
      }) {
        this.buffer = [];
        this.finalPasswords = [];
        this.substr = substr;
        this.limit = limit;
        this.trieRoot = trieRoot;
      }
      getAllPossibleSubsAtIndex(index) {
        const nodes = [];
        let cur = this.trieRoot;
        for (let i = index; i < this.substr.length; i += 1) {
          const character = this.substr.charAt(i);
          cur = cur.getChild(character);
          if (!cur) {
            break;
          }
          nodes.push(cur);
        }
        return nodes;
      }
      // eslint-disable-next-line complexity,max-statements
      helper({
        index,
        subIndex,
        changes,
        lastSubLetter,
        consecutiveSubCount
      }) {
        if (this.finalPasswords.length >= this.limit) {
          return;
        }
        if (index === this.substr.length) {
          this.finalPasswords.push({
            password: this.buffer.join(''),
            changes
          });
          return;
        }
        // first, exhaust all possible substitutions at this index
        const nodes = [...this.getAllPossibleSubsAtIndex(index)];
        let hasSubs = false;
        // iterate backward to get wider substitutions first
        for (let i = index + nodes.length - 1; i >= index; i -= 1) {
          const cur = nodes[i - index];
          const sub = cur.parents.join('');
          if (cur.isTerminal()) {
            // Skip if this would be a 4th or more consecutive substitution of the same letter
            // this should work in all language as there shouldn't be the same letter more than four times in a row
            // So we can ignore the rest to save calculation time
            if (lastSubLetter === sub && consecutiveSubCount >= 3) {
              continue;
            }
            hasSubs = true;
            const letters = cur.subs;
            for (const letter of letters) {
              this.buffer.push(letter);
              const newSubs = changes.concat({
                i: subIndex,
                letter,
                substitution: sub
              });
              // recursively build the rest of the string
              this.helper({
                index: index + sub.length,
                subIndex: subIndex + letter.length,
                changes: newSubs,
                lastSubLetter: sub,
                consecutiveSubCount: lastSubLetter === sub ? consecutiveSubCount + 1 : 1
              });
              // backtrack by ignoring the added postfix
              this.buffer.pop();
              if (this.finalPasswords.length >= this.limit) {
                return;
              }
            }
          }
        }
        // keep the character only if there is no substitution at this index
        if (!hasSubs) {
          const firstChar = this.substr.charAt(index);
          this.buffer.push(firstChar);
          this.helper({
            index: index + 1,
            subIndex: subIndex + 1,
            changes,
            lastSubLetter,
            consecutiveSubCount
          });
          this.buffer.pop();
        }
      }
      getAll() {
        this.helper({
          index: 0,
          subIndex: 0,
          changes: [],
          lastSubLetter: undefined,
          consecutiveSubCount: 0
        });
        return this.finalPasswords;
      }
    }
    // The passwords with every possible substitution made, up to limit of them.
    // The l33t matcher checks them with levenshtein, it finds the l33t words of
    // the password itself by walking the word index.
    const getCleanPasswords = (password, limit, trieRoot) => {
      const helper = new CleanPasswords({
        substr: password,
        limit,
        trieRoot
      });
      return helper.getAll();
    };

    // The narrow calls one password may take. A password made of substitutions
    // that each stand for several letters (eg. '!'.repeat(256)) branches at every
    // character, the walk of a start then stops early and keeps the matches found
    // so far. Every start gets a share of it, so the end of a password is walked
    // no matter how much the start of it branches. What is left afterwards goes to
    // the starts that were stopped, so they only miss words once it is used up.
    const L33T_NARROW_BUDGET = 100000;
    // the changes in [i, j] once each, as the match lists them
    const getSubs = changes => {
      const subs = [];
      const subDisplay = [];
      const seenSubs = new Set();
      changes.forEach(({
        letter,
        substitution
      }) => {
        const subKey = `${letter}-${substitution}`;
        if (!seenSubs.has(subKey)) {
          seenSubs.add(subKey);
          subs.push({
            letter,
            substitution
          });
          subDisplay.push(`${substitution} -> ${letter}`);
        }
      });
      return {
        subs,
        subDisplay: subDisplay.join(', ')
      };
    };
    // Walks the word index from every start of the password. At each character
    // it continues with every substitution that starts there, for each letter it
    // stands for, and with the character itself. A branch ends as soon as no word
    // starts with it, so only prefixes of words are explored.
    class L33tWalk {
      constructor(options) {
        // the substitutions made so far, in password positions
        this.changes = [];
        // the words per depth, they share their first depth characters
        this.rangesByDepth = [];
        this.start = 0;
        // the substitutions that match at each position, of the lowercased
        // password and then of the password as it is
        this.substitutionsAt = [];
        // the last position a substitution matches at, -1 for none. A branch
        // without changes past it can't make one anymore, so it never matches.
        this.lastSubstitution = -1;
        this.narrowCount = 0;
        // the narrowCount at which the walk of the current start stops
        this.narrowLimit = 0;
        // if the limit stopped the walk of the current start
        this.stopped = false;
        this.largestShare = 0;
        this.options = options;
        this.password = options.password;
        this.passwordLower = toLowerCase(options.password);
        for (let position = 0; position < this.password.length; position += 1) {
          const matching = this.getSubstitutionsAt(position);
          this.substitutionsAt.push(matching);
          if (matching.length > 0) {
            this.lastSubstitution = position;
          }
        }
      }
      run() {
        this.ensureRanges(0);
        let stoppedStarts = this.walkEveryStart();
        // A stopped start walks again from its beginning, so it needs more than it
        // had to get further. The cheapest ones finish first.
        while (stoppedStarts.length > 0 && this.narrowCount < this.options.budget) {
          this.largestShare *= 2;
          stoppedStarts = stoppedStarts.filter(start => this.walkStart(start, this.largestShare));
        }
      }
      // the starts their share wasn't enough for
      walkEveryStart() {
        const stoppedStarts = [];
        for (let start = 0; start <= this.lastSubstitution; start += 1) {
          // an equal share of what is left, what a start doesn't use goes to the
          // ones after it
          const startsLeft = this.lastSubstitution - start + 1;
          const budgetLeft = Math.max(0, this.options.budget - this.narrowCount);
          const share = Math.ceil(budgetLeft / startsLeft);
          this.largestShare = Math.max(this.largestShare, share);
          if (this.walkStart(start, share)) {
            stoppedStarts.push(start);
          }
        }
        return stoppedStarts;
      }
      // true if the share wasn't enough to finish the walk of start
      walkStart(start, share) {
        this.start = start;
        this.rangesByDepth[0].reset();
        this.narrowLimit = Math.min(this.narrowCount + share, this.options.budget);
        this.stopped = false;
        this.walk(start, 0);
        return this.stopped;
      }
      hasBudget() {
        if (this.narrowCount >= this.narrowLimit) {
          this.stopped = true;
          return false;
        }
        return true;
      }
      ensureRanges(depth) {
        const {
          wordIndex,
          userInputsWordIndex
        } = this.options;
        for (let next = this.rangesByDepth.length; next <= depth; next += 1) {
          this.rangesByDepth.push(new WordRanges(wordIndex, userInputsWordIndex));
        }
      }
      // the words of depth narrowed by characters, into the words of the depth
      // after them. False if no word starts with them.
      narrow(depth, characters) {
        this.ensureRanges(depth + characters.length);
        const ranges = this.rangesByDepth[depth + characters.length];
        ranges.copy(this.rangesByDepth[depth]);
        for (let index = 0; index < characters.length; index += 1) {
          this.narrowCount += ranges.narrow(depth + index, characters.charCodeAt(index));
          if (ranges.isEmpty()) {
            return false;
          }
        }
        return true;
      }
      // the word of exactly depth characters in the words of depth, if any
      emit(position, depth) {
        const {
          wordIndex,
          onWord
        } = this.options;
        const ranges = this.rangesByDepth[depth];
        const word = ranges.getWord(depth);
        const userInputsRank = ranges.getUserInputsRank(depth);
        if (word !== -1 || userInputsRank !== undefined) {
          onWord({
            i: this.start,
            j: position - 1,
            matchedWord: word === -1 ? ranges.getUserInput() : wordIndex.words[word],
            word,
            userInputsRank,
            changes: this.changes
          });
        }
      }
      // the substitutions that start at position, of the password lowercased or
      // as it is. One with an uppercase character after a lowercase first one
      // (eg. 'nN') only matches the password as it is.
      getSubstitutionsAt(position) {
        const {
          substitutions
        } = this.options;
        const lower = this.passwordLower.charAt(position);
        const character = this.password.charAt(position);
        const matching = (substitutions.get(lower) || []).filter(({
          substitution
        }) => this.passwordLower.startsWith(substitution, position) || this.password.startsWith(substitution, position));
        if (character !== lower) {
          (substitutions.get(character) || []).forEach(candidate => {
            if (this.password.startsWith(candidate.substitution, position)) {
              matching.push(candidate);
            }
          });
        }
        return matching;
      }
      // eslint-disable-next-line complexity
      walk(position, depth) {
        if (depth > 0 && this.changes.length > 0) {
          this.emit(position, depth);
        }
        if (position === this.password.length || this.changes.length === 0 && position > this.lastSubstitution) {
          return;
        }
        for (const {
          substitution,
          letters,
          lettersLower
        } of this.substitutionsAt[position]) {
          for (let index = 0; index < letters.length; index += 1) {
            const letterLower = lettersLower[index];
            if (this.hasBudget() && this.narrow(depth, letterLower)) {
              this.changes.push({
                i: position,
                letter: letters[index],
                substitution
              });
              this.walk(position + substitution.length, depth + letterLower.length);
              this.changes.pop();
            }
          }
        }
        if (this.hasBudget() && this.narrow(depth, this.passwordLower.charAt(position))) {
          this.walk(position + 1, depth + 1);
        }
      }
    }
    /*
     * -------------------------------------------------------------------------------
     *  Dictionary l33t matching -----------------------------------------------------
     * -------------------------------------------------------------------------------
     */
    class MatchL33t extends MatchDictionary {
      constructor() {
        super(...arguments);
        this.narrowBudget = L33T_NARROW_BUDGET;
      }
      match({
        password,
        userInputsOptions
      }) {
        const matches = [];
        const seen = new Set();
        const {
          wordIndex
        } = this.options;
        const userInputsWordIndex = userInputsOptions === null || userInputsOptions === void 0 ? void 0 : userInputsOptions.wordIndex;
        // Another branch to a word in seenWords has the same hits, so it is
        // skipped before they are looked up. The levenshtein hits of a word differ
        // from the ones of the walk, so each has its own seenWords.
        const addMatches = ({
          i,
          j,
          matchedWord,
          changes
        }, getHits, seenWords) => {
          const wordKey = `${i}\u0000${j}\u0000${matchedWord}`;
          if (seenWords.has(wordKey)) {
            return;
          }
          seenWords.add(wordKey);
          const token = password.slice(i, j + 1);
          // only the matches that contain an actual substitution, and no single
          // characters: '1' would match 'i' and '4' would match 'a', both very
          // common English words with a low rank
          if (toLowerCase(token) === matchedWord || countCharacters(token) <= 1) {
            return;
          }
          let extras;
          getHits().forEach(({
            dictionaryName,
            rank,
            ...levenshtein
          }) => {
            const key = `${wordKey}\u0000${dictionaryName}`;
            if (seen.has(key)) {
              return;
            }
            seen.add(key);
            extras !== null && extras !== void 0 ? extras : extras = getSubs(changes);
            matches.push({
              pattern: 'dictionary',
              i,
              j,
              token,
              matchedWord,
              rank,
              dictionaryName,
              reversed: false,
              l33t: true,
              ...levenshtein,
              ...extras
            });
          });
        };
        if (this.options.useLevenshteinDistance) {
          const seenLevenshteinWords = new Set();
          // levenshtein only checks the full password, so the l33t words close
          // to it are only found with every possible substitution made
          getCleanPasswords(password, this.options.l33tMaxSubstitutions, this.options.trieNodeRoot).forEach(({
            password: subbedPassword,
            changes
          }) => {
            if (changes.length === 0) {
              return;
            }
            const matchedWord = toLowerCase(subbedPassword);
            addMatches({
              i: 0,
              j: password.length - 1,
              matchedWord,
              changes
            }, () => this.getLevenshteinHits(matchedWord, userInputsWordIndex), seenLevenshteinWords);
          });
        }
        const userInputsPosition = getUserInputsPosition(wordIndex);
        const seenWalkWords = new Set();
        new L33tWalk({
          password,
          substitutions: this.options.l33tSubstitutions,
          wordIndex,
          userInputsWordIndex,
          budget: this.narrowBudget,
          onWord: found => {
            addMatches(found, () => this.getHits(found.word, found.userInputsRank, userInputsPosition), seenWalkWords);
          }
        }).run();
        return matches;
      }
    }

    /*
     * -------------------------------------------------------------------------------
     *  Dictionary reverse matching --------------------------------------------------
     * -------------------------------------------------------------------------------
     */
    class MatchReverse extends MatchDictionary {
      match(matchOptions) {
        // Array.from splits by Unicode code point rather than UTF-16 code unit,
        // so surrogate pairs (eg. emoji) survive the reversal intact.
        const passwordReversed = Array.from(matchOptions.password).reverse().join('');
        return super.match({
          ...matchOptions,
          password: passwordReversed
        }).map(match => ({
          ...match,
          token: Array.from(match.token).reverse().join(''),
          // reverse back
          reversed: true,
          // map coordinates back to original string
          i: matchOptions.password.length - 1 - match.j,
          j: matchOptions.password.length - 1 - match.i
        }));
      }
    }

    /*
     * -------------------------------------------------------------------------------
     *  regex matching ---------------------------------------------------------------
     * -------------------------------------------------------------------------------
     */
    class MatchRegex extends MatcherBaseClass {
      match({
        password
      }) {
        const matches = [];
        Object.keys(REGEXEN).forEach(name => {
          const regex = REGEXEN[name];
          regex.lastIndex = 0; // keeps regexMatch stateless
          let regexMatch;
          while (regexMatch = regex.exec(password)) {
            const token = regexMatch[0];
            matches.push({
              pattern: 'regex',
              token,
              i: regexMatch.index,
              j: regexMatch.index + regexMatch[0].length - 1,
              regexName: name,
              regexMatch
            });
          }
        });
        return matches;
      }
    }

    const LOG10 = Math.log(10);
    // factorials[n] = n!, extended when a larger one is asked for
    const factorials = [1];
    var utils = {
      // binomial coefficients
      // src: http://blog.plover.com/math/choose.html
      nCk(n, k) {
        let count = n;
        if (k > count) {
          return 0;
        }
        if (k === 0) {
          return 1;
        }
        let coEff = 1;
        for (let i = 1; i <= k; i += 1) {
          coEff *= count;
          coEff /= i;
          count -= 1;
        }
        return coEff;
      },
      factorial(n) {
        for (let i = factorials.length; i <= n; i += 1) {
          factorials[i] = factorials[i - 1] * i;
        }
        return factorials[n];
      },
      log10(n) {
        if (n === 0) return 0;
        return Math.log(n) / LOG10; // IE doesn't support Math.log10 :(
      }
    };

    // guesses for a bruteforce token of tokenLength characters (code points).
    // The scoring search calls this directly to rate bruteforce candidates
    // without creating a match object for each of them.
    const bruteforceGuesses = tokenLength => {
      let guesses = BRUTEFORCE_CARDINALITY ** tokenLength;
      if (guesses === Number.POSITIVE_INFINITY) {
        guesses = Number.MAX_VALUE;
      }
      let minGuesses;
      // small detail: make bruteforce matches at minimum one guess bigger than smallest allowed
      // submatch guesses, such that non-bruteforce submatches over the same [i..j] take precedence.
      if (tokenLength === 1) {
        minGuesses = MIN_SUBMATCH_GUESSES_SINGLE_CHAR + 1;
      } else {
        minGuesses = MIN_SUBMATCH_GUESSES_MULTI_CHAR + 1;
      }
      return Math.max(guesses, minGuesses);
    };
    var bruteforceMatcher$1 = ({
      token
    }) => bruteforceGuesses(countCharacters(token));

    var dateMatcher$1 = ({
      year,
      separator
    }) => {
      // base guesses: (year distance from REFERENCE_YEAR) * num_days * num_years
      const yearSpace = Math.max(Math.abs(year - REFERENCE_YEAR), MIN_YEAR_SPACE);
      let guesses = yearSpace * 365;
      // add factor of 4 for separator selection (one of ~4 choices)
      if (separator) {
        guesses *= 4;
      }
      return guesses;
    };

    const getVariations = cleanedWord => {
      const wordArray = cleanedWord.split('');
      const upperCaseCount = wordArray.filter(char => char.match(ONE_UPPER)).length;
      const lowerCaseCount = wordArray.filter(char => char.match(ONE_LOWER)).length;
      let variations = 0;
      const variationLength = Math.min(upperCaseCount, lowerCaseCount);
      for (let i = 1; i <= variationLength; i += 1) {
        variations += utils.nCk(upperCaseCount + lowerCaseCount, i);
      }
      return variations;
    };
    var uppercaseVariant = word => {
      // clean words of non alpha characters to remove the reward effekt to capitalize the first letter https://github.com/dropbox/zxcvbn/issues/232
      const cleanedWord = word.replace(ALPHA_INVERTED, '');
      if (cleanedWord.match(ALL_LOWER_INVERTED) || cleanedWord.toLowerCase() === cleanedWord) {
        return 1;
      }
      // a capitalized word is the most common capitalization scheme,
      // so it only doubles the search space (uncapitalized + capitalized).
      // all caps and end-capitalized are common enough too, underestimate as 2x factor to be safe.
      const commonCases = [START_UPPER, END_UPPER, ALL_UPPER_INVERTED];
      const commonCasesLength = commonCases.length;
      for (let i = 0; i < commonCasesLength; i += 1) {
        const regex = commonCases[i];
        if (cleanedWord.match(regex)) {
          return 2;
        }
      }
      // otherwise calculate the number of ways to capitalize U+L uppercase+lowercase letters
      // with U uppercase letters or less. or, if there's more uppercase than lower (for eg. PASSwORD),
      // the number of ways to lowercase U+L letters with L lowercase letters or less.
      return getVariations(cleanedWord);
    };

    const countSubstring = (string, substring) => {
      let count = 0;
      let pos = string.indexOf(substring);
      while (pos >= 0) {
        count += 1;
        pos = string.indexOf(substring, pos + substring.length);
      }
      return count;
    };
    const getCounts = ({
      sub,
      token
    }) => {
      // lower-case match.token before calculating: capitalization shouldn't affect l33t calc.
      const tokenLower = token.toLowerCase();
      // num of subbed chars
      const subbedCount = countSubstring(tokenLower, sub.substitution);
      // num of unsubbed chars
      const unsubbedCount = countSubstring(tokenLower, sub.letter);
      return {
        subbedCount,
        unsubbedCount
      };
    };
    var l33tVariant = ({
      l33t,
      subs,
      token
    }) => {
      if (!l33t) {
        return 1;
      }
      let variations = 1;
      subs.forEach(sub => {
        const {
          subbedCount,
          unsubbedCount
        } = getCounts({
          sub,
          token
        });
        if (subbedCount === 0 || unsubbedCount === 0) {
          // for this sub, password is either fully subbed (444) or fully unsubbed (aaa)
          // treat that as doubling the space (attacker needs to try fully subbed chars in addition to
          // unsubbed.)
          variations *= 2;
        } else {
          // this case is similar to capitalization:
          // with aa44a, U = 3, S = 2, attacker needs to try unsubbed + one sub + two subs
          const p = Math.min(unsubbedCount, subbedCount);
          let possibilities = 0;
          for (let i = 1; i <= p; i += 1) {
            possibilities += utils.nCk(unsubbedCount + subbedCount, i);
          }
          variations *= possibilities;
        }
      });
      return variations;
    };

    var dictionaryMatcher$1 = ({
      rank,
      reversed,
      l33t,
      subs,
      token,
      dictionaryName
    }) => {
      const baseGuesses = rank; // keep these as properties for display purposes
      const uppercaseVariations = uppercaseVariant(token);
      const l33tVariations = l33tVariant({
        l33t,
        subs,
        token
      });
      const reversedVariations = reversed && 2 || 1;
      let calculation;
      if (isDictionaryNamed(dictionaryName, 'diceware')) {
        // diceware dictionaries are special, so we get a simple scoring of 1/2 of 6^5 (6 digits on 5 dice)
        // to get fix entropy of ~12.9 bits for every entry https://en.wikipedia.org/wiki/Diceware#:~:text=The%20level%20of,bits
        calculation = 6 ** 5 / 2;
      } else {
        calculation = baseGuesses * uppercaseVariations * l33tVariations * reversedVariations;
      }
      return {
        baseGuesses,
        uppercaseVariations,
        l33tVariations,
        calculation
      };
    };

    var regexMatcher$1 = ({
      regexName,
      regexMatch,
      token
    }) => {
      const charClassBases = {
        alphaLower: 26,
        alphaUpper: 26,
        alpha: 52,
        alphanumeric: 62,
        digits: 10,
        symbols: 33
      };
      if (regexName in charClassBases) {
        return charClassBases[regexName] ** token.length;
      }
      // TODO add more regex types for example special dates like 09.11
      switch (regexName) {
        case 'recentYear':
          // conservative estimate of year space: num years from REFERENCE_YEAR.
          // if year is close to REFERENCE_YEAR, estimate a year space of MIN_YEAR_SPACE.
          return Math.max(Math.abs(parseInt(regexMatch[0], 10) - REFERENCE_YEAR), MIN_YEAR_SPACE);
      }
      return 0;
    };

    var repeatMatcher$1 = ({
      baseGuesses,
      repeatCount
    }) => baseGuesses * repeatCount;

    var sequenceMatcher$1 = ({
      token,
      ascending
    }) => {
      const firstChr = token.charAt(0);
      let baseGuesses;
      const startingPoints = ['a', 'A', 'z', 'Z', '0', '1', '9'];
      // lower guesses for obvious starting points
      if (startingPoints.includes(firstChr)) {
        baseGuesses = 4;
      } else if (/\d/.exec(firstChr)) {
        baseGuesses = 10; // digits
      } else {
        // could give a higher base for uppercase,
        // assigning 26 to both upper and lower sequences is more conservative.
        baseGuesses = 26;
      }
      // need to try a descending sequence in addition to every ascending sequence ->
      // 2x guesses
      if (!ascending) {
        baseGuesses *= 2;
      }
      return baseGuesses * countCharacters(token);
    };

    const calcAverageDegree = graph => {
      let average = 0;
      Object.keys(graph).forEach(key => {
        const neighbors = graph[key];
        average += neighbors.filter(entry => !!entry).length;
      });
      average /= Object.entries(graph).length;
      return average;
    };
    const estimatePossiblePatterns = (graphEntry, {
      token,
      turns
    }) => {
      const startingPosition = Object.keys(graphEntry).length;
      const averageDegree = calcAverageDegree(graphEntry);
      let guesses = 0;
      const tokenLength = token.length;
      // # estimate the number of possible patterns w/ tokenLength or less with turns or less.
      for (let i = 2; i <= tokenLength; i += 1) {
        const possibleTurns = Math.min(turns, i - 1);
        for (let j = 1; j <= possibleTurns; j += 1) {
          guesses += utils.nCk(i - 1, j - 1) * startingPosition * averageDegree ** j;
        }
      }
      return guesses;
    };
    var spatialMatcher$1 = ({
      graph,
      token,
      shiftedCount,
      turns
    }, options) => {
      let guesses = estimatePossiblePatterns(options.graphs[graph], {
        token,
        turns
      });
      // add extra guesses for shifted keys. (% instead of 5, A instead of a.)
      // math is similar to extra guesses of l33t substitutions in dictionary matches.
      if (shiftedCount) {
        const unShiftedCount = token.length - shiftedCount;
        if (shiftedCount === 0 || unShiftedCount === 0) {
          guesses *= 2;
        } else {
          let shiftedVariations = 0;
          for (let i = 1; i <= Math.min(shiftedCount, unShiftedCount); i += 1) {
            shiftedVariations += utils.nCk(shiftedCount + unShiftedCount, i);
          }
          guesses *= shiftedVariations;
        }
      }
      return Math.round(guesses);
    };

    var separatorMatcher$1 = () => {
      return SEPARATOR_CHAR_COUNT;
    };

    const product = values => values.reduce((result, value) => result * value, 1);
    // a gap is made of separators or, for camelCase, a single uppercase letter
    const gapOptions = gap => WORD_SEQUENCE_SEPARATOR_CHARS.has(gap[0]) ? WORD_SEQUENCE_SEPARATOR_CHARS.size : WORD_SEQUENCE_LETTER_GAP_OPTIONS;
    // picking the gap character, plus how often it is repeated.
    // a mixed run like '._' is charged per character
    const gapVariations = gap => new Set(gap).size === 1 ? gapOptions(gap) * gap.length : gapOptions(gap) ** gap.length;
    // custom matchers registered as wordSequence may not provide separators
    const separatorVariations = (separators = []) => {
      const gaps = separators.filter(gap => gap !== '');
      if (gaps.length === 0) {
        return 1;
      }
      // when only some words are separated, each gap may or may not hold a separator
      const placements = gaps.length === separators.length ? 1 : 2 ** separators.length;
      // the same separator between every word only has to be guessed once
      if (new Set(gaps).size === 1) {
        return placements * gapVariations(gaps[0]);
      }
      // so does a single character, only its run lengths are charged per gap
      if (new Set(gaps.join('')).size === 1) {
        return placements * gapOptions(gaps[0]) * product(gaps.map(gap => gap.length));
      }
      return placements * product(gaps.map(gap => gapVariations(gap)));
    };
    var wordSequenceMatcher$1 = match => {
      if (match.pattern !== 'wordSequence') {
        return 0;
      }
      // Base guesses: factorial of word count (number of ways to order the words)
      const baseGuesses = utils.factorial(match.wordCount);
      // Additional penalty for longer sequences
      const lengthPenalty = 2 ** (match.wordCount - 2);
      return baseGuesses * lengthPenalty * separatorVariations(match.separators);
    };

    const getMinGuesses = (match, password) => {
      let minGuesses = 1;
      if (match.token.length < password.length) {
        // a single character is at most 2 UTF-16 code units (eg. an emoji).
        // Check the length first, this runs for every bruteforce candidate
        if (match.token.length <= 2 && countCharacters(match.token) === 1) {
          minGuesses = MIN_SUBMATCH_GUESSES_SINGLE_CHAR;
        } else {
          minGuesses = MIN_SUBMATCH_GUESSES_MULTI_CHAR;
        }
      }
      return minGuesses;
    };
    const matchers = {
      bruteforce: bruteforceMatcher$1,
      date: dateMatcher$1,
      dictionary: dictionaryMatcher$1,
      regex: regexMatcher$1,
      repeat: repeatMatcher$1,
      sequence: sequenceMatcher$1,
      spatial: spatialMatcher$1,
      separator: separatorMatcher$1,
      wordSequence: wordSequenceMatcher$1
    };
    const getScoring = (options, name, match) => {
      if (matchers[name]) {
        return matchers[name](match, options);
      }
      if (options.matchers[name] && 'scoring' in options.matchers[name]) {
        return options.matchers[name].scoring(match, options);
      }
      return 0;
    };
    // the floor the guesses of a match were estimated with, only kept for
    // estimates that a floor can have changed
    const estimatedFloors = new WeakMap();
    // the guesses of a match by its pattern. A dictionary match also gets the
    // numbers they are calculated from.
    const getGuesses = (options, match) => {
      const estimationResult = getScoring(options, match.pattern, match);
      if (typeof estimationResult === 'number') {
        return estimationResult;
      }
      if (match.pattern === 'dictionary') {
        match.baseGuesses = estimationResult.baseGuesses;
        match.uppercaseVariations = estimationResult.uppercaseVariations;
        match.l33tVariations = estimationResult.l33tVariations;
        return estimationResult.calculation;
      }
      return 0;
    };
    // ------------------------------------------------------------------------------
    // guess estimation -- one function per match pattern ---------------------------
    // ------------------------------------------------------------------------------
    var estimateGuesses = (options, match, password) => {
      // a match's guess estimate doesn't change. cache it. Guesses set by the
      // caller are kept as they are. Ours include the floor of the password they
      // were estimated for, which only matters when they are at most the highest
      // floor: then they are estimated again for another floor.
      if ('guesses' in match && match.guesses != null) {
        const estimatedFloor = match.guesses > MIN_SUBMATCH_GUESSES_MULTI_CHAR ? undefined : estimatedFloors.get(match);
        if (estimatedFloor === undefined || estimatedFloor === getMinGuesses(match, password)) {
          return match;
        }
      }
      const minGuesses = getMinGuesses(match, password);
      // The estimate is written onto the match itself instead of a copy, this
      // runs for every match of every check. Matching copies the matches of
      // custom matchers, so the match is new for this check.
      const estimated = match;
      const matchGuesses = Math.max(getGuesses(options, estimated), minGuesses);
      estimated.guesses = matchGuesses;
      if (matchGuesses <= MIN_SUBMATCH_GUESSES_MULTI_CHAR) {
        estimatedFloors.set(estimated, minGuesses);
      }
      estimated.guessesLog10 = utils.log10(matchGuesses);
      return estimated;
    };

    const isBruteforce = match => typeof match === 'number' || match.pattern === 'bruteforce';
    // in log10 units, far above the rounding error of the bounds, so a skipped
    // bruteforce candidate is always one that would be rejected
    const BOUND_TOLERANCE = 1e-9;
    class Scoring {
      constructor(options) {
        this.options = options;
        this.password = '';
        this.state = {
          bestMatches: [],
          guessesProduct: [],
          totalGuesses: []
        };
        this.excludeAdditive = false;
        // factorials[n] = n!, up to the longest possible sequence
        this.factorials = [1];
        // additivePenalties[n] = MIN_GUESSES_BEFORE_GROWING_SEQUENCE ** (n - 1)
        this.additivePenalties = [1];
        // bestUpTo[sequenceLength] = the fewest total guesses of the sequences
        // ending at the current endIndex with sequenceLength or fewer matches,
        // Infinity if there are none. Every update is for the current endIndex, so
        // the competing sequences of a candidate are compared at once.
        this.bestUpTo = new Float64Array(1);
        // the index whose best sequences the search is finding, every update is
        // for a sequence ending there. A sequence ending at endIndex has at most
        // endIndex + 1 matches
        this.endIndex = 0;
        // characterCounts[n] = number of characters (code points) in password[0, n)
        this.characterCounts = new Int32Array(1);
        // bruteforceGuessesByLength[n] = bruteforceGuesses(n), for every token length
        this.bruteforceGuessesByLength = [];
        // startBounds[i] = the lowest log10(sequenceLength! * guessesProduct) of
        // the sequences ending at i - 1 that a bruteforce match from i can extend,
        // minus the characters of password[0, i). Infinity if there are none.
        // A bruteforce match of c characters adds a factor of at least 10^c, so
        // its candidates make at least 10^(characters up to its end + bound) guesses.
        this.startBounds = new Float64Array(1);
        // startLengths[i] = the lengths of the sequences ending at i - 1 that a
        // bruteforce match from i can extend, the ones not ending in bruteforce
        this.startLengths = [];
      }
      // helper: make bruteforce match objects spanning i to j, inclusive.
      makeBruteforceMatch(i, j) {
        return {
          pattern: 'bruteforce',
          token: this.password.slice(i, j + 1),
          i,
          j
        };
      }
      prepare(password) {
        const passwordLength = password.length;
        this.factorials = [1];
        this.additivePenalties = [1];
        this.bruteforceGuessesByLength = [bruteforceGuesses(0)];
        for (let n = 1; n <= passwordLength + 1; n += 1) {
          this.factorials[n] = utils.factorial(n);
          this.additivePenalties[n] = MIN_GUESSES_BEFORE_GROWING_SEQUENCE ** (n - 1);
          this.bruteforceGuessesByLength[n] = bruteforceGuesses(n);
        }
        this.bestUpTo = new Float64Array(passwordLength + 2);
        this.prepareCharacterCounts(password);
        this.startBounds = new Float64Array(passwordLength);
        this.startLengths = [];
        this.state = {
          bestMatches: Array.from({
            length: passwordLength
          }, () => []),
          guessesProduct: Array.from({
            length: passwordLength
          }, () => []),
          totalGuesses: Array.from({
            length: passwordLength
          }, () => [])
        };
      }
      prepareCharacterCounts(password) {
        const passwordLength = password.length;
        // the low half of a surrogate pair doesn't count as a character
        this.characterCounts = new Int32Array(passwordLength + 1);
        for (let index = 0; index < passwordLength; index += 1) {
          const isPairedLowSurrogate = index > 0 && isSurrogatePairAt(password, index - 1);
          this.characterCounts[index + 1] = this.characterCounts[index] + (isPairedLowSurrogate ? 0 : 1);
        }
      }
      // same as countCharacters(password.slice(i, j + 1)), from the counts
      countTokenCharacters(i, j) {
        const counts = this.characterCounts;
        let count = counts[j + 1] - counts[i];
        // a token starting in the middle of a surrogate pair counts that half
        if (counts[i + 1] === counts[i]) {
          count += 1;
        }
        return count;
      }
      // helper: considers whether a length-sequenceLength
      // sequence ending at match is better (fewer guesses)
      // than previously encountered sequences, updating state if so.
      // match ends at endIndex. Its guesses are passed in, a bruteforce match is
      // only its start index and has none to read
      // eslint-disable-next-line max-statements, complexity
      update(match, guesses, sequenceLength) {
        const {
          endIndex
        } = this;
        let pi = guesses;
        if (sequenceLength > 1) {
          const i = typeof match === 'number' ? match : match.i;
          // we're considering a length-sequenceLength sequence ending with match:
          // obtain the product term in the minimization function by multiplying match's guesses
          // by the product of the length-(sequenceLength-1)
          // sequence ending just before match, at match.i - 1.
          pi *= this.state.guessesProduct[i - 1][sequenceLength - 1];
        }
        // calculate the minimization func
        let sequenceGuesses = this.factorials[sequenceLength] * pi;
        if (!this.excludeAdditive) {
          sequenceGuesses += this.additivePenalties[sequenceLength];
        }
        // update state if new best.
        // first see if any competing sequences covering this prefix,
        // with sequenceLength or fewer matches,
        // fare better than this sequence. if so, skip it and return.
        const competingGuesses = this.state.totalGuesses[endIndex];
        const {
          bestUpTo
        } = this;
        if (sequenceGuesses === Number.POSITIVE_INFINITY) {
          // bestUpTo can't tell an Infinity sequence from none
          const maxCompetingLength = Math.min(sequenceLength, competingGuesses.length - 1);
          for (let length = 1; length <= maxCompetingLength; length += 1) {
            if (competingGuesses[length] !== undefined) {
              return;
            }
          }
        } else if (bestUpTo[sequenceLength] <= sequenceGuesses) {
          return;
        }
        // this sequence might be part of the final optimal sequence.
        // bestUpTo doesn't increase with the length, so it stops at the first
        // length that already has as few
        for (let length = sequenceLength; length <= endIndex + 1 && bestUpTo[length] > sequenceGuesses; length += 1) {
          bestUpTo[length] = sequenceGuesses;
        }
        competingGuesses[sequenceLength] = sequenceGuesses;
        this.state.bestMatches[endIndex][sequenceLength] = match;
        this.state.guessesProduct[endIndex][sequenceLength] = pi;
      }
      // helper: sets startBounds[i] once the sequences ending at i - 1 are final
      boundStart(i) {
        const previousBestMatches = this.state.bestMatches[i - 1];
        const previousGuessesProduct = this.state.guessesProduct[i - 1];
        const lengths = [];
        let bound = Number.POSITIVE_INFINITY;
        for (let sequenceLength = 1; sequenceLength < previousBestMatches.length; sequenceLength += 1) {
          const lastMatch = previousBestMatches[sequenceLength];
          // corner: an optimal sequence will never have two adjacent bruteforce matches.
          // it is strictly better to have a single bruteforce match spanning the same region:
          // same contribution to the guess product with a lower length.
          // --> safe to skip those cases.
          if (lastMatch !== undefined && !isBruteforce(lastMatch)) {
            lengths.push(sequenceLength);
            bound = Math.min(bound, Math.log10(this.factorials[sequenceLength + 1] * previousGuessesProduct[sequenceLength]));
          }
        }
        this.startBounds[i] = bound - this.characterCounts[i];
        this.startLengths[i] = lengths;
      }
      // helper: evaluate bruteforce matches ending at passwordCharIndex.
      bruteforceUpdate(passwordCharIndex) {
        // see if a single bruteforce match spanning the passwordCharIndex-prefix is optimal.
        this.update(0, this.bruteforceGuessesByLength[this.countTokenCharacters(0, passwordCharIndex)], 1);
        // every candidate below has a sequence length of 2 or more, so update
        // rejects it unless it beats the best length 1 and 2 sequences, which
        // only get better in this loop. A start whose bound doesn't beat them
        // is skipped, the same as update would reject all of its candidates.
        const skipFrom = Math.log10(this.bestUpTo[2]) - this.characterCounts[passwordCharIndex + 1] + BOUND_TOLERANCE;
        for (let i = 1; i <= passwordCharIndex; i += 1) {
          if (this.startBounds[i] >= skipFrom) {
            continue;
          }
          // generate passwordCharIndex bruteforce matches, spanning from (i=1, j=passwordCharIndex) up to (i=passwordCharIndex, j=passwordCharIndex).
          // see if adding these new matches to any of the sequences in optimal[i-1]
          // leads to new bests.
          const lengths = this.startLengths[i];
          const guesses = this.bruteforceGuessesByLength[this.countTokenCharacters(i, passwordCharIndex)];
          for (const sequenceLength of lengths) {
            // try adding the bruteforce match to this length-sequenceLength sequence.
            this.update(i, guesses, sequenceLength + 1);
          }
        }
      }
      // helper: finds the best sequences ending at endIndex, from the matches
      // ending there
      step(endIndex, matchesAtEnd) {
        this.endIndex = endIndex;
        this.bestUpTo.fill(Number.POSITIVE_INFINITY, 0, endIndex + 2);
        matchesAtEnd.forEach(match => {
          // a match's guess estimate doesn't change, estimate it once
          const estimatedMatch = estimateGuesses(this.options, match, this.password);
          const {
            i,
            guesses
          } = estimatedMatch;
          if (i > 0) {
            const previousBestMatches = this.state.bestMatches[i - 1];
            for (let sequenceLength = 1; sequenceLength < previousBestMatches.length; sequenceLength += 1) {
              if (previousBestMatches[sequenceLength] !== undefined) {
                this.update(estimatedMatch, guesses, sequenceLength + 1);
              }
            }
          } else {
            this.update(estimatedMatch, guesses, 1);
          }
        });
        this.bruteforceUpdate(endIndex);
        if (endIndex + 1 < this.password.length) {
          this.boundStart(endIndex + 1);
        }
      }
      // helper: the sequence length with the fewest total guesses
      // covering the whole password
      getBestSequenceLength(passwordLength) {
        let sequenceLength = 0;
        // Infinity, not Number.MAX_VALUE: bruteforce guesses are capped at
        // MAX_VALUE, so the only candidate can be exactly MAX_VALUE
        let fewestGuesses = Number.POSITIVE_INFINITY;
        const totalGuessesAtLastChar = this.state.totalGuesses[passwordLength - 1];
        if (totalGuessesAtLastChar) {
          for (let candidateSequenceLength = 1; candidateSequenceLength < totalGuessesAtLastChar.length; candidateSequenceLength += 1) {
            const candidateMetricMatch = totalGuessesAtLastChar[candidateSequenceLength];
            if (candidateMetricMatch !== undefined && candidateMetricMatch < fewestGuesses) {
              sequenceLength = candidateSequenceLength;
              fewestGuesses = candidateMetricMatch;
            }
          }
        }
        return sequenceLength;
      }
      // helper: step backwards through bestMatches starting at the end,
      // constructing the final optimal match sequence.
      unwind(passwordLength) {
        const optimalMatchSequence = [];
        let endIndex = passwordLength - 1;
        let sequenceLength = this.getBestSequenceLength(passwordLength);
        while (endIndex >= 0) {
          const bestMatch = this.state.bestMatches[endIndex][sequenceLength];
          const match = typeof bestMatch === 'number' ? estimateGuesses(this.options, this.makeBruteforceMatch(bestMatch, endIndex), this.password) : bestMatch;
          optimalMatchSequence.unshift(match);
          endIndex = match.i - 1;
          sequenceLength -= 1;
        }
        return optimalMatchSequence;
      }
      // ------------------------------------------------------------------------------
      // search --- most guessable match sequence -------------------------------------
      // ------------------------------------------------------------------------------
      //
      // takes a sequence of overlapping matches, returns the non-overlapping sequence with
      // minimum guesses. the following is a O(l_max * (n + m)) dynamic programming algorithm
      // for a length-n password with m candidate matches. l_max is the maximum optimal
      // sequence length spanning each prefix of the password. In practice it rarely exceeds 5 and the
      // search terminates rapidly.
      //
      // the optimal "minimum guesses" sequence is here defined to be the sequence that
      // minimizes the following function:
      //
      //    totalGuesses = sequenceLength! * Product(m.guesses for m in sequence) + D^(sequenceLength - 1)
      //
      // where sequenceLength is the length of the sequence.
      //
      // the factorial term is the number of ways to order sequenceLength patterns.
      //
      // the D^(sequenceLength-1) term is another length penalty, roughly capturing the idea that an
      // attacker will try lower-length sequences first before trying length-sequenceLength sequences.
      //
      // for example, consider a sequence that is date-repeat-dictionary.
      //  - an attacker would need to try other date-repeat-dictionary combinations,
      //    hence the product term.
      //  - an attacker would need to try repeat-date-dictionary, dictionary-repeat-date,
      //    ..., hence the factorial term.
      //  - an attacker would also likely try length-1 (dictionary) and length-2 (dictionary-date)
      //    sequences before length-3. assuming at minimum D guesses per pattern type,
      //    D^(sequenceLength-1) approximates Sum(D^i for i in [1..sequenceLength-1]
      //
      // ------------------------------------------------------------------------------
      mostGuessableMatchSequence(password, matches, excludeAdditive = false) {
        this.password = password;
        this.excludeAdditive = excludeAdditive;
        const passwordLength = password.length;
        // partition matches into sublists according to ending index j
        const matchesByCoordinateJ = Array.from({
          length: passwordLength
        }, () => []);
        matches.forEach(match => {
          matchesByCoordinateJ[match.j].push(match);
        });
        // small detail: for deterministic output, sort each sublist by i.
        matchesByCoordinateJ.forEach(matchesAtJ => matchesAtJ.sort((m1, m2) => m1.i - m2.i));
        this.prepare(password);
        for (let endIndex = 0; endIndex < passwordLength; endIndex += 1) {
          this.step(endIndex, matchesByCoordinateJ[endIndex]);
        }
        const optimalMatchSequence = this.unwind(passwordLength);
        const optimalSequenceLength = optimalMatchSequence.length;
        const guesses = this.getGuesses(password, optimalSequenceLength);
        return {
          password,
          guesses,
          guessesLog10: utils.log10(guesses),
          sequence: optimalMatchSequence
        };
      }
      getGuesses(password, optimalSequenceLength) {
        const passwordLength = password.length;
        if (password.length === 0) {
          return 1;
        } else {
          return this.state.totalGuesses[passwordLength - 1][optimalSequenceLength];
        }
      }
    }

    /*
     *-------------------------------------------------------------------------------
     * repeats (aaa, abcabcabc) ------------------------------
     *-------------------------------------------------------------------------------
     */
    class MatchRepeat extends MatcherBaseClass {
      constructor(options) {
        super(options);
        this.scoring = new Scoring(options);
      }
      // eslint-disable-next-line max-statements
      match(matchOptions) {
        const {
          password
        } = matchOptions;
        // Scoped to this call rather than an instance field: getBaseGuesses
        // recurses back into this same instance via omniMatch.match(baseToken),
        // and a shared field would get cleared by that nested call before the
        // outer loop's later iterations could reuse it.
        const memoizedResults = new Map();
        const matches = [];
        let lastIndex = 0;
        while (lastIndex < password.length) {
          const greedyMatch = this.getGreedyMatch(password, lastIndex);
          const lazyMatch = this.getLazyMatch(password, lastIndex);
          if (greedyMatch == null) {
            break;
          }
          const {
            match,
            baseToken
          } = this.setMatchToken(greedyMatch, lazyMatch);
          if (match) {
            const j = match.index + match[0].length - 1;
            const baseGuesses = this.getBaseGuesses(baseToken, matchOptions, memoizedResults);
            matches.push(this.normalizeMatch(baseToken, j, match, baseGuesses));
            lastIndex = j + 1;
          }
        }
        const hasPromises = matches.some(match => {
          return match instanceof Promise;
        });
        if (hasPromises) {
          // eslint-disable-next-line @typescript-eslint/await-thenable
          return Promise.all(matches);
        }
        return matches;
      }
      // eslint-disable-next-line max-params
      normalizeMatch(baseToken, j, match, baseGuesses) {
        const baseMatch = {
          pattern: 'repeat',
          i: match.index,
          j,
          token: match[0],
          baseToken,
          baseGuesses: 0,
          repeatCount: match[0].length / baseToken.length
        };
        if (baseGuesses instanceof Promise) {
          return baseGuesses.then(resolvedBaseGuesses => {
            return {
              ...baseMatch,
              baseGuesses: resolvedBaseGuesses
            };
          });
        }
        return {
          ...baseMatch,
          baseGuesses
        };
      }
      getGreedyMatch(password, lastIndex) {
        MatchRepeat.GREEDY.lastIndex = lastIndex;
        return MatchRepeat.GREEDY.exec(password);
      }
      getLazyMatch(password, lastIndex) {
        MatchRepeat.LAZY.lastIndex = lastIndex;
        return MatchRepeat.LAZY.exec(password);
      }
      setMatchToken(greedyMatch, lazyMatch) {
        let match;
        let baseToken = '';
        if (lazyMatch && greedyMatch[0].length > lazyMatch[0].length) {
          // greedy beats lazy for 'aabaab'
          // greedy: [aabaab, aab]
          // lazy:   [aa,     a]
          match = greedyMatch;
          // greedy's repeated string might itself be repeated, eg.
          // aabaab in aabaabaabaab.
          // run an anchored lazy match on greedy's repeated string
          // to find the shortest repeated string
          const temp = MatchRepeat.LAZY_ANCHORED.exec(match[0]);
          if (temp) {
            baseToken = temp[1];
          }
        } else {
          // lazy beats greedy for 'aaaaa'
          // greedy: [aaaa,  aa]
          // lazy:   [aaaaa, a]
          match = lazyMatch;
          if (match) {
            baseToken = match[1];
          }
        }
        return {
          match,
          baseToken
        };
      }
      // the base token is matched with the same matchers and user inputs as the
      // password it repeats in
      getBaseGuesses(baseToken, {
        omniMatch,
        userInputsOptions
      }, memoizedResults) {
        // memoizedResults lives for one match() call, which has a single
        // userInputsOptions, so baseToken alone is a safe key
        if (memoizedResults.has(baseToken)) {
          return memoizedResults.get(baseToken);
        }
        const matches = omniMatch.match(baseToken, userInputsOptions);
        let result;
        if (matches instanceof Promise) {
          result = matches.then(resolvedMatches => {
            const baseAnalysis = this.scoring.mostGuessableMatchSequence(baseToken, resolvedMatches);
            return baseAnalysis.guesses;
          });
        } else {
          const baseAnalysis = this.scoring.mostGuessableMatchSequence(baseToken, matches);
          result = baseAnalysis.guesses;
        }
        memoizedResults.set(baseToken, result);
        return result;
      }
    }
    // the u flag makes '.' match a whole code point, so a repeat can't start or
    // end in the middle of an emoji (surrogate pair)
    MatchRepeat.GREEDY = /(.+)\1+/gu;
    MatchRepeat.LAZY = /(.+?)\1+/gu;
    MatchRepeat.LAZY_ANCHORED = /^(.+?)\1+$/u;

    /*
     *-------------------------------------------------------------------------------
     * sequences (abcdef) ------------------------------
     *-------------------------------------------------------------------------------
     */
    class MatchSequence extends MatcherBaseClass {
      constructor() {
        super(...arguments);
        this.MAX_DELTA = 5;
      }
      // eslint-disable-next-line max-statements
      match({
        password
      }) {
        /*
         * Identifies sequences by looking for repeated differences in unicode codepoint.
         * this allows skipping, such as 9753, and also matches some extended unicode sequences
         * such as Greek and Cyrillic alphabets.
         *
         * for example, consider the input 'abcdb975zy'
         *
         * password: a   b   c   d   b    9   7   5   z   y
         * index:    0   1   2   3   4    5   6   7   8   9
         * delta:      1   1   1  -2  -41  -2  -2  69   1
         *
         * expected result:
         * [(i, j, delta), ...] = [(0, 3, 1), (5, 7, -2), (8, 9, 1)]
         */
        const result = [];
        // split by Unicode code point rather than UTF-16 code unit, so a
        // surrogate pair (eg. an astral-plane character) is treated as one
        // character with one codepoint delta instead of two meaningless ones
        const characters = Array.from(password);
        if (characters.length <= 1) {
          return [];
        }
        // [i, j] are reported in UTF-16 code units (like every other matcher), so
        // track the code-unit offset each character starts at
        const unitOffsets = [];
        let unitOffset = 0;
        characters.forEach(character => {
          unitOffsets.push(unitOffset);
          unitOffset += character.length;
        });
        const lastUnitIndex = charIndex => unitOffsets[charIndex] + characters[charIndex].length - 1;
        let i = 0;
        let lastDelta = null;
        const charactersLength = characters.length;
        for (let k = 1; k < charactersLength; k += 1) {
          const delta = characters[k].codePointAt(0) - characters[k - 1].codePointAt(0);
          if (lastDelta === null) {
            lastDelta = delta;
          }
          if (delta !== lastDelta) {
            const j = k - 1;
            this.update({
              i: unitOffsets[i],
              j: lastUnitIndex(j),
              characterCount: j - i + 1,
              delta: lastDelta,
              password,
              result
            });
            i = j;
            lastDelta = delta;
          }
        }
        this.update({
          i: unitOffsets[i],
          j: lastUnitIndex(charactersLength - 1),
          characterCount: charactersLength - i,
          delta: lastDelta,
          password,
          result
        });
        return result;
      }
      // [i, j] are UTF-16 code units, characterCount is the number of code points
      // between them: a run of two surrogate pairs is 2 characters, not 4
      update({
        i,
        j,
        characterCount,
        delta,
        password,
        result
      }) {
        if (characterCount > 2 || Math.abs(delta) === 1) {
          const absoluteDelta = Math.abs(delta);
          if (absoluteDelta > 0 && absoluteDelta <= this.MAX_DELTA) {
            const token = password.slice(i, j + 1);
            const {
              sequenceName,
              sequenceSpace
            } = this.getSequence(token);
            return result.push({
              pattern: 'sequence',
              i,
              j,
              token,
              sequenceName,
              sequenceSpace,
              ascending: delta > 0
            });
          }
        }
        return null;
      }
      getSequence(token) {
        // TODO conservatively stick with roman alphabet size.
        //  (this could be improved)
        let sequenceName = 'unicode';
        let sequenceSpace = 26;
        if (ALL_LOWER.test(token)) {
          sequenceName = 'lower';
          sequenceSpace = 26;
        } else if (ALL_UPPER.test(token)) {
          sequenceName = 'upper';
          sequenceSpace = 26;
        } else if (ALL_DIGIT.test(token)) {
          sequenceName = 'digits';
          sequenceSpace = 10;
        }
        return {
          sequenceName,
          sequenceSpace
        };
      }
    }

    /*
     * ------------------------------------------------------------------------------
     * spatial match (qwerty/dvorak/keypad and so on) -----------------------------------------
     * ------------------------------------------------------------------------------
     */
    class MatchSpatial extends MatcherBaseClass {
      match({
        password
      }) {
        const matches = [];
        Object.keys(this.options.graphs).forEach(graphName => {
          const graph = this.options.graphs[graphName];
          extend(matches, this.helper(password, graph, graphName));
        });
        return matches;
      }
      checkIfShifted(graphName, password, index) {
        if (!graphName.includes('keypad') &&
        // initial character is shifted
        MatchSpatial.SHIFTED_RX.test(password.charAt(index))) {
          return 1;
        }
        return 0;
      }
      // eslint-disable-next-line complexity, max-statements
      helper(password, graph, graphName) {
        let shiftedCount;
        const matches = [];
        let i = 0;
        const passwordLength = password.length;
        while (i < passwordLength - 1) {
          let j = i + 1;
          let lastDirection = null;
          let turns = 0;
          shiftedCount = this.checkIfShifted(graphName, password, i);
          let prevCharAdjacents = graph[password.charAt(i)] || [];
          while (true) {
            let found = false;
            let curDirection = -1;
            // consider growing pattern by one character if j hasn't gone over the edge.
            if (j < passwordLength) {
              const curChar = password.charAt(j);
              const adjacentsLength = prevCharAdjacents.length;
              for (let k = 0; k < adjacentsLength; k += 1) {
                const adjacent = prevCharAdjacents[k];
                curDirection += 1;
                // eslint-disable-next-line max-depth
                if (adjacent) {
                  const adjacentIndex = adjacent.indexOf(curChar);
                  // eslint-disable-next-line max-depth
                  if (adjacentIndex !== -1) {
                    found = true;
                    // eslint-disable-next-line max-depth
                    if (adjacentIndex === 1) {
                      // # index 1 in the adjacency means the key is shifted,
                      // # 0 means unshifted: A vs a, % vs 5, etc.
                      // # for example, 'q' is adjacent to the entry '2@'.
                      // # @ is shifted w/ index 1, 2 is unshifted.
                      shiftedCount += 1;
                    }
                    const foundDirection = curDirection;
                    // eslint-disable-next-line max-depth
                    if (lastDirection !== foundDirection) {
                      // # adding a turn is correct even in the initial
                      // case when last_direction is null:
                      // # every spatial pattern starts with a turn.
                      turns += 1;
                      lastDirection = foundDirection;
                    }
                    break;
                  }
                }
              }
            }
            // if the current pattern continued, extend j and try to grow again
            if (found) {
              prevCharAdjacents = graph[password.charAt(j)] || [];
              j += 1;
              // otherwise push the pattern discovered so far, if any...
            } else {
              // don't consider length 1 or 2 chains.
              if (j - i > 2) {
                matches.push({
                  pattern: 'spatial',
                  i,
                  j: j - 1,
                  token: password.slice(i, j),
                  graph: graphName,
                  turns,
                  shiftedCount
                });
              }
              // ...and then start a new search for the rest of the password.
              i = j;
              break;
            }
          }
        }
        return matches;
      }
    }
    MatchSpatial.SHIFTED_RX = /[~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?]/;

    // a set instead of a regex character class, so no separator ('-', '\\', ']', '^')
    // can turn into a range or an escape depending on its position in the list
    const separatorChars = new Set(SEPARATOR_CHARS);
    /*
     *-------------------------------------------------------------------------------
     * separators (any semi-repeated special character) -----------------------------
     *-------------------------------------------------------------------------------
     */
    class MatchSeparator extends MatcherBaseClass {
      static getMostUsedSeparatorChar(password) {
        const counts = new Map();
        for (const char of password) {
          if (separatorChars.has(char)) {
            counts.set(char, (counts.get(char) || 0) + 1);
          }
        }
        let maxChar;
        let maxCount = 0;
        for (const [char, count] of counts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            maxChar = char;
          }
        }
        // If the special character is only used once, don't treat it like a separator
        if (maxCount < 2) {
          return undefined;
        }
        return maxChar;
      }
      static getSeparatorRegex(separator) {
        const escaped = separator.replace(ESCAPE_REGEX, '\\$&');
        return new RegExp(`([^${escaped}\n])(${escaped})(?!${escaped})`, 'g');
        // negative lookbehind can be added again in a few years when it is more supported by the browsers (currently 2023)
        // https://github.com/zxcvbn-ts/zxcvbn/issues/202
        // return new RegExp(`(?<!${separator})(${separator})(?!${separator})`, 'g')
      }
      match({
        password
      }) {
        const result = [];
        if (password.length === 0) return result;
        const mostUsedSpecial = MatchSeparator.getMostUsedSeparatorChar(password);
        if (mostUsedSpecial === undefined) return result;
        const isSeparator = MatchSeparator.getSeparatorRegex(mostUsedSpecial);
        for (const match of password.matchAll(isSeparator)) {
          // add one to the index because we changed the regex from negative lookbehind to something simple.
          // this simple approach uses the first character before the separater too but we only need the index of the separater
          // https://github.com/zxcvbn-ts/zxcvbn/issues/202
          // matchAll always yields a defined index for a successful match; only `groups` is optional.
          const i = match.index + 1;
          result.push({
            pattern: 'separator',
            token: mostUsedSpecial,
            i,
            j: i
          });
        }
        return result;
      }
    }

    // a gap of only separators. '' (plain concatenation) counts too, since there
    // is no character to reject
    const isSeparatorRun = text => {
      for (const char of text) {
        if (!WORD_SEQUENCE_SEPARATOR_CHARS.has(char)) {
          return false;
        }
      }
      return true;
    };
    /*
     *-------------------------------------------------------------------------------
     * word sequences (oneTwoThree, fourFiveSix) ------------------------------
     *-------------------------------------------------------------------------------
     */
    class MatchWordSequence extends MatcherBaseClass {
      match(matchOptions) {
        const {
          password,
          matches = []
        } = matchOptions;
        const dictionaryMatches = matches.filter(match => match.pattern === 'dictionary' && this.options.isWordSequence(match.dictionaryName));
        const filteredDictionaryMatches = this.filterDictionaryMatches(dictionaryMatches);
        // Find sequences of consecutive words. These are added as additional
        // candidates alongside the dictionary/l33t matches they're built from -
        // Scoring's DP picks whichever is cheaper, so the component matches must
        // stay in `matches` rather than being removed here.
        return this.findWordSequences(filteredDictionaryMatches, password);
      }
      filterDictionaryMatches(matches) {
        // sort by start index, then by end index
        return matches.sort((a, b) => {
          if (a.i !== b.i) return a.i - b.i;
          if (a.j !== b.j) return a.j - b.j;
          // prefer forward over reversed
          if (a.reversed !== b.reversed) return a.reversed ? 1 : -1;
          // prefer non-l33t
          if (a.l33t !== b.l33t) return a.l33t ? 1 : -1;
          // prefer better rank
          return a.rank - b.rank;
        })
        // Keep only non-overlapping matches, favoring earlier ones
        .reduce((acc, match) => {
          const last = acc[acc.length - 1];
          if (!last || match.i > last.j) {
            acc.push(match);
          }
          return acc;
        }, []);
      }
      findWordSequences(wordMatches, password) {
        const sequences = [];
        if (wordMatches.length === 0) {
          return sequences;
        }
        // Find all possible sequences
        for (let startIdx = 0; startIdx < wordMatches.length; startIdx += 1) {
          const sequencesFromStart = this.findSequencesFromStart(wordMatches, startIdx, password);
          sequences.push(...sequencesFromStart);
        }
        return sequences;
      }
      findSequencesFromStart(sortedMatches, startIdx, password) {
        const sequences = [];
        const startMatch = sortedMatches[startIdx];
        // Start with single word sequence
        const currentSequence = [startMatch];
        // Sequences starting later are covered by the caller's loop over startIdx
        for (let nextIdx = startIdx + 1; nextIdx < sortedMatches.length; nextIdx += 1) {
          const nextMatch = sortedMatches[nextIdx];
          // sortedMatches always comes from filterDictionaryMatches, which already
          // guarantees each entry starts after the previous one ends, so a
          // non-extending match is always a gap, never an overlap to skip.
          if (!this.isValidWordSequence(currentSequence, nextMatch, password)) {
            break;
          }
          // A separator run can make the longer sequence more expensive than
          // stopping here and matching the run separately (e.g. as a repeat), so
          // keep the sequence so far as a candidate before extending over it.
          const lastWord = currentSequence[currentSequence.length - 1];
          if (currentSequence.length > 1 && nextMatch.i - lastWord.j > 2) {
            sequences.push(this.createWordSequenceMatch(currentSequence, password));
          }
          currentSequence.push(nextMatch);
        }
        if (currentSequence.length > 1) {
          sequences.push(this.createWordSequenceMatch(currentSequence, password));
        }
        return sequences;
      }
      isValidWordSequence(currentSequence, nextMatch, password) {
        // Get the text between the last word and the next word
        const lastWord = currentSequence[currentSequence.length - 1];
        const textBetween = password.slice(lastWord.j + 1, nextMatch.i);
        // For snake_case, kebab-case, simple concatenation or a run of separators
        // like '..'. Longer runs are not free: scoring charges for them.
        const hasValidSeparator = isSeparatorRun(textBetween);
        // For camelCase, we need to check if the next word starts with uppercase
        // and there's no separator (or just a single character that could be uppercase)
        const isCamelCase = textBetween.length === 1 && textBetween === textBetween.toUpperCase() && textBetween !== textBetween.toLowerCase();
        return hasValidSeparator || isCamelCase;
      }
      createWordSequenceMatch(sequence, password) {
        const firstMatch = sequence[0];
        const lastMatch = sequence[sequence.length - 1];
        const words = sequence.map(match => match.matchedWord);
        // one entry per gap, so scoring can tell which words are separated
        const separators = sequence.slice(1).map((match, index) => password.slice(sequence[index].j + 1, match.i));
        // Determine if sequence is ascending (by rank)
        const ranks = sequence.map(match => match.rank);
        const ascending = ranks.every((rank, i) => i === 0 || rank >= ranks[i - 1]);
        // Use the most common dictionary name, or the first one
        const dictionaryNames = sequence.map(match => match.dictionaryName);
        const dictionaryName = this.getMostCommon(dictionaryNames) || firstMatch.dictionaryName;
        return {
          pattern: 'wordSequence',
          i: firstMatch.i,
          j: lastMatch.j,
          token: password.slice(firstMatch.i, lastMatch.j + 1),
          words,
          wordCount: words.length,
          dictionaryName,
          ascending,
          separators
        };
      }
      getMostCommon(array) {
        if (array.length === 0) return null;
        const counts = new Map();
        let maxCount = 0;
        let mostCommon = null;
        array.forEach(item => {
          const count = (counts.get(item) || 0) + 1;
          counts.set(item, count);
          if (count > maxCount) {
            maxCount = count;
            mostCommon = item;
          }
        });
        return mostCommon;
      }
    }

    // buckets smaller than this are sorted by insertion instead of by character
    const INSERTION_SORT_SIZE = 24;
    const flatten = lists => {
      let count = 0;
      lists.forEach(({
        words
      }) => {
        count += words.length;
      });
      const entries = {
        words: new Array(count),
        dictionaries: new Uint16Array(count),
        ranks: new Int32Array(count)
      };
      let entry = 0;
      lists.forEach(({
        words
      }, dictionary) => {
        for (let index = 0; index < words.length; index += 1) {
          // numbers are listed too, they match as their string
          entries.words[entry] = String(words[index]);
          entries.dictionaries[entry] = dictionary;
          entries.ranks[entry] = index + 1;
          entry += 1;
        }
      });
      return entries;
    };
    // The character codes that occur, numbered from 1 in code unit order. 0 is
    // for a word that ends before the position that is sorted on. Every code unit
    // can occur, so the last id can be 65536.
    const getCharacterIds = words => {
      const ids = new Uint32Array(65536);
      words.forEach(word => {
        for (let index = 0; index < word.length; index += 1) {
          ids[word.charCodeAt(index)] = 1;
        }
      });
      let count = 0;
      for (let code = 0; code < ids.length; code += 1) {
        if (ids[code] !== 0) {
          count += 1;
          ids[code] = count;
        }
      }
      return {
        ids,
        count
      };
    };
    // Sorts the entries by word in UTF-16 code unit order, the order of
    // Array.prototype.sort, and keeps entries with the same word in list order.
    // A radix sort by character code, the native sort with a comparator is
    // about three times slower for a few hundred thousand words.
    class EntrySorter {
      constructor(words) {
        this.words = words;
        // the id of order[index] at the depth being sorted, read once per pass
        this.keys = new Uint16Array(0);
        this.ids = new Uint32Array(0);
        this.idCount = 0;
        // per depth, so a bucket being sorted deeper keeps the state of its parent
        this.countsByDepth = [];
        this.idsByDepth = [];
        this.order = new Int32Array(words.length);
        for (let index = 0; index < words.length; index += 1) {
          this.order[index] = index;
        }
        this.buffer = new Int32Array(words.length);
      }
      sort() {
        // only needed to sort by character, a few words are sorted by insertion
        if (this.words.length >= INSERTION_SORT_SIZE) {
          const {
            ids,
            count
          } = getCharacterIds(this.words);
          this.ids = ids;
          this.idCount = count;
          this.keys = count < 65536 ? new Uint16Array(this.words.length) : new Uint32Array(this.words.length);
        }
        this.sortRange(0, this.words.length, 0);
        return this.order;
      }
      getId(word, depth) {
        return depth < word.length ? this.ids[word.charCodeAt(depth)] : 0;
      }
      getState(depth) {
        if (!this.countsByDepth[depth]) {
          this.countsByDepth[depth] = new Int32Array(this.idCount + 1);
          this.idsByDepth[depth] = new Int32Array(this.idCount + 1);
        }
        return {
          counts: this.countsByDepth[depth],
          idsInRange: this.idsByDepth[depth]
        };
      }
      // All words in [start, end) share their first depth characters. Only the
      // ids that occur in the range are visited, the alphabet of all languages
      // has thousands of characters but a range has few of them.
      // eslint-disable-next-line max-statements
      sortRange(start, end, depth) {
        if (end - start < INSERTION_SORT_SIZE) {
          this.insertionSort(start, end, depth);
          return;
        }
        const {
          order,
          buffer,
          keys,
          words
        } = this;
        const {
          counts,
          idsInRange
        } = this.getState(depth);
        let idCount = 0;
        for (let index = start; index < end; index += 1) {
          const id = this.getId(words[order[index]], depth);
          keys[index] = id;
          if (counts[id] === 0) {
            idsInRange[idCount] = id;
            idCount += 1;
          }
          counts[id] += 1;
        }
        const sortedIds = idsInRange.subarray(0, idCount).sort();
        // counts[id] becomes the start of the bucket of id
        let bucketStart = start;
        sortedIds.forEach(id => {
          const count = counts[id];
          counts[id] = bucketStart;
          bucketStart += count;
        });
        // stable, an entry keeps its place among the entries of its bucket
        for (let index = start; index < end; index += 1) {
          const id = keys[index];
          buffer[counts[id]] = order[index];
          counts[id] += 1;
        }
        order.set(buffer.subarray(start, end), start);
        // counts[id] is now the end of the bucket of id. Id 0 holds the words
        // that end here, they are all the same.
        bucketStart = start;
        sortedIds.forEach(id => {
          const bucketEnd = counts[id];
          if (id !== 0 && bucketEnd - bucketStart > 1) {
            this.sortRange(bucketStart, bucketEnd, depth + 1);
          }
          bucketStart = bucketEnd;
          counts[id] = 0;
        });
      }
      // compares from depth on, the characters before it are the same
      compare(first, second, depth) {
        let index = depth;
        while (index < first.length && index < second.length && first.charCodeAt(index) === second.charCodeAt(index)) {
          index += 1;
        }
        // a word that ends sorts first
        const firstCode = index < first.length ? first.charCodeAt(index) : -1;
        const secondCode = index < second.length ? second.charCodeAt(index) : -1;
        return firstCode - secondCode;
      }
      insertionSort(start, end, depth) {
        const {
          order,
          words
        } = this;
        for (let index = start + 1; index < end; index += 1) {
          const entry = order[index];
          let target = index;
          // stops at an equal word, so entries with the same word keep their order
          while (target > start && this.compare(words[order[target - 1]], words[entry], depth) > 0) {
            order[target] = order[target - 1];
            target -= 1;
          }
          order[target] = entry;
        }
      }
    }
    // Every word of all dictionaries once, sorted, with the dictionaries and
    // ranks it has. The words that start with a prefix are next to each other,
    // so dictionary matching can extend a prefix one character at a time and stop
    // as soon as no word starts with it.
    class WordIndex {
      // eslint-disable-next-line max-statements
      constructor(lists = []) {
        this.findRange = new Int32Array(2);
        // The words that start with a character are at [firstCharacterStarts[n],
        // firstCharacterStarts[n + 1]), n being firstCharacters.get(its code).
        // Narrowing all words by their first character is the widest and so
        // slowest search, and every matcher does it for every start in a password.
        this.firstCharacters = new Map();
        this.levenshteinDictionaries = [];
        this.listSizes = lists.map(({
          words
        }) => words.length);
        this.dictionaryNames = lists.map(({
          name
        }) => name);
        const entries = flatten(lists);
        const order = new EntrySorter(entries.words).sort();
        const words = [];
        const hitStart = new Int32Array(order.length + 1);
        const hitDictionary = lists.length <= 256 ? new Uint8Array(order.length) : new Uint16Array(order.length);
        const hitRank = new Int32Array(order.length);
        let hitCount = 0;
        let previousWord;
        order.forEach(entry => {
          const word = entries.words[entry];
          const dictionary = entries.dictionaries[entry];
          if (word !== previousWord) {
            hitStart[words.length] = hitCount;
            words.push(word);
            previousWord = word;
          } else if (hitDictionary[hitCount - 1] === dictionary) {
            // listed twice in one dictionary, the last rank wins
            hitRank[hitCount - 1] = entries.ranks[entry];
            return;
          }
          hitDictionary[hitCount] = dictionary;
          hitRank[hitCount] = entries.ranks[entry];
          hitCount += 1;
        });
        hitStart[words.length] = hitCount;
        this.words = words;
        this.hitStart = hitStart.slice(0, words.length + 1);
        this.hitDictionary = hitDictionary.slice(0, hitCount);
        this.hitRank = hitRank.slice(0, hitCount);
        this.firstCharacterStarts = this.getFirstCharacterStarts();
      }
      // the words are sorted, so the ones with the same first character are
      // next to each other
      getFirstCharacterStarts() {
        const starts = [];
        this.words.forEach((word, index) => {
          if (word.length === 0) {
            return;
          }
          const code = word.charCodeAt(0);
          if (!this.firstCharacters.has(code)) {
            this.firstCharacters.set(code, starts.length);
            starts.push(index);
          }
        });
        starts.push(this.words.length);
        return Int32Array.from(starts);
      }
      // the first index in [start, end) whose word has at least code at depth,
      // the words in [start, end) share their first depth characters
      // eslint-disable-next-line max-params
      findFirst(start, end, depth, code) {
        let low = start;
        let high = end;
        while (low < high) {
          const middle = low + high >>> 1;
          const word = this.words[middle];
          // a word that ends at depth sorts first
          const middleCode = depth < word.length ? word.charCodeAt(depth) : -1;
          if (middleCode < code) {
            low = middle + 1;
          } else {
            high = middle;
          }
        }
        return low;
      }
      // The range of [start, end) whose words have code at depth, as
      // [first, end) in range[0] and range[1]. The words in [start, end) share
      // their first depth characters.
      narrow(range, depth, code) {
        if (depth === 0 && range[0] === 0 && range[1] === this.words.length) {
          const position = this.firstCharacters.get(code);
          if (position === undefined) {
            range[0] = range[1];
          } else {
            range[0] = this.firstCharacterStarts[position];
            range[1] = this.firstCharacterStarts[position + 1];
          }
          return;
        }
        const first = this.findFirst(range[0], range[1], depth, code);
        range[1] = this.findFirst(first, range[1], depth, code + 1);
        range[0] = first;
      }
      // the index of word, or -1
      find(word) {
        const range = this.findRange;
        range[0] = 0;
        range[1] = this.words.length;
        for (let depth = 0; depth < word.length && range[0] < range[1]; depth += 1) {
          this.narrow(range, depth, word.charCodeAt(depth));
        }
        return range[0] < range[1] && this.words[range[0]].length === word.length ? range[0] : -1;
      }
      // the words of a dictionary for levenshtein, built on first use
      getLevenshteinDictionary(dictionary) {
        let levenshteinDictionary = this.levenshteinDictionaries[dictionary];
        if (!levenshteinDictionary) {
          levenshteinDictionary = {
            getEntries: () => this.getEntries(dictionary),
            getRank: entry => this.getRank(this.find(entry), dictionary)
          };
          this.levenshteinDictionaries[dictionary] = levenshteinDictionary;
        }
        return levenshteinDictionary;
      }
      getWordsByRank(dictionary) {
        if (!this.wordsByRank) {
          const wordsByRank = this.listSizes.map(size => new Int32Array(size));
          for (let wordIndex = 0; wordIndex < this.words.length; wordIndex += 1) {
            for (let hit = this.hitStart[wordIndex]; hit < this.hitStart[wordIndex + 1]; hit += 1) {
              wordsByRank[this.hitDictionary[hit]][this.hitRank[hit] - 1] = wordIndex + 1;
            }
          }
          this.wordsByRank = wordsByRank;
        }
        return this.wordsByRank[dictionary];
      }
      // the words of a dictionary in rank order, from the index and not the list
      // it was created from, so both always have the same words
      getEntries(dictionary) {
        const entries = [];
        const ranks = [];
        this.getWordsByRank(dictionary).forEach((word, index) => {
          // a word listed twice leaves a hole at the rank it doesn't have
          if (word > 0) {
            entries.push(this.words[word - 1]);
            ranks.push(index + 1);
          }
        });
        return {
          entries,
          ranks
        };
      }
      // the rank of words[wordIndex] in a dictionary, or undefined
      getRank(wordIndex, dictionary) {
        if (wordIndex < 0) {
          return undefined;
        }
        for (let hit = this.hitStart[wordIndex]; hit < this.hitStart[wordIndex + 1]; hit += 1) {
          if (this.hitDictionary[hit] === dictionary) {
            return this.hitRank[hit];
          }
        }
        return undefined;
      }
    }

    // An object built by hand without wordIndex only has the ranked dictionary,
    // its words are put in the word index in the order of their rank. Without
    // this the user inputs would be skipped.
    const withWordIndex = userInputsOptions => {
      if (!userInputsOptions || userInputsOptions.wordIndex) {
        return userInputsOptions;
      }
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const words = Object.entries(userInputsOptions.rankedDictionary).sort((first, second) => first[1] - second[1]).map(([word]) => word);
      return {
        ...userInputsOptions,
        wordIndex: new WordIndex([{
          name: 'userInputs',
          words
        }])
      };
    };
    /*
     * -------------------------------------------------------------------------------
     *  Omnimatch combine matchers ---------------------------------------------------------------
     * -------------------------------------------------------------------------------
     */
    class Matching {
      constructor(options) {
        this.options = options;
        this.matchers = {};
        this.matchers = {
          date: new MatchDate(this.options),
          dictionary: new MatchDictionary(this.options),
          dictionaryL33t: new MatchL33t(this.options),
          dictionaryReverse: new MatchReverse(this.options),
          regex: new MatchRegex(this.options),
          repeat: new MatchRepeat(this.options),
          sequence: new MatchSequence(this.options),
          spatial: new MatchSpatial(this.options),
          separator: new MatchSeparator(this.options),
          wordSequence: new MatchWordSequence(this.options)
        };
        Object.entries(this.options.matchers).forEach(([key, Matcher]) => {
          this.matchers[key] = new Matcher.Matching(this.options);
        });
      }
      match(password, givenUserInputsOptions) {
        const userInputsOptions = withWordIndex(givenUserInputsOptions);
        const matches = [];
        const promises = [];
        // wordSequence reads the shared `matches` array to find sequences of
        // dictionary matches, so it must run once every other matcher's results
        // (sync or async) have already landed in `matches` - it can't just be
        // one more entry in the same iteration order.
        const {
          wordSequence,
          ...otherMatchers
        } = this.matchers;
        // Scoring writes the guesses onto the matches. A custom matcher may
        // return the same objects for every check, so its matches are copied and
        // never carry the guesses of an earlier check.
        const add = (name, result) => {
          extend(matches, name in this.options.matchers ? result.map(match => ({
            ...match
          })) : result);
        };
        Object.entries(otherMatchers).forEach(([name, matcher]) => {
          const result = matcher.match({
            password,
            omniMatch: this,
            userInputsOptions
          });
          if (result instanceof Promise) {
            promises.push(result.then(response => {
              add(name, response);
              return response;
            }));
          } else {
            add(name, result);
          }
        });
        // The matches are left unsorted: scoring groups them by j and sorts each
        // group by i, which gives the same order a sort by i and j would
        const runWordSequence = () => {
          if (!wordSequence) {
            return matches;
          }
          // a copy, so a custom wordSequence matcher can't drop or reorder the
          // matches of the other matchers
          const result = wordSequence.match({
            password,
            omniMatch: this,
            userInputsOptions,
            matches: matches.slice()
          });
          if (result instanceof Promise) {
            return result.then(response => {
              add('wordSequence', response);
              return matches;
            });
          }
          add('wordSequence', result);
          return matches;
        };
        if (promises.length > 0) {
          return Promise.all(promises).then(runWordSequence);
        }
        return runWordSequence();
      }
    }

    const SECOND = 1;
    const MINUTE = SECOND * 60;
    const HOUR = MINUTE * 60;
    const DAY = HOUR * 24;
    const MONTH = DAY * 31;
    const YEAR = MONTH * 12;
    const CENTURY = YEAR * 100;
    const times = {
      second: SECOND,
      minute: MINUTE,
      hour: HOUR,
      day: DAY,
      month: MONTH,
      year: YEAR,
      century: CENTURY
    };
    const timeEstimationValuesDefaults = {
      scoring: {
        0: 1e3,
        1: 1e6,
        2: 1e8,
        3: 1e10
      },
      attackTime: {
        onlineThrottlingXPerHour: 100,
        onlineNoThrottlingXPerSecond: 10,
        offlineSlowHashingXPerSecond: 1e4,
        offlineFastHashingXPerSecond: 1e10
      }
    };
    /*
     * -------------------------------------------------------------------------------
     *  Estimates time for an attacker ---------------------------------------------------------------
     * -------------------------------------------------------------------------------
     */
    class TimeEstimates {
      constructor(options) {
        this.options = options;
      }
      estimateAttackTimes(guesses) {
        const crackTimesSeconds = this.calculateCrackTimesSeconds(guesses);
        const crackTimes = {};
        Object.keys(crackTimesSeconds).forEach(crackTime => {
          const usedScenario = crackTime;
          const seconds = crackTimesSeconds[usedScenario];
          const {
            base,
            displayStr
          } = this.displayTime(seconds);
          crackTimes[usedScenario] = {
            base,
            seconds,
            display: this.translate(displayStr, base)
          };
        });
        return {
          crackTimes,
          score: this.guessesToScore(guesses)
        };
      }
      calculateCrackTimesSeconds(guesses) {
        const attackTimesOptions = this.options.timeEstimationValues.attackTime;
        return {
          onlineThrottlingXPerHour: guesses / (attackTimesOptions.onlineThrottlingXPerHour / 3600),
          onlineNoThrottlingXPerSecond: guesses / attackTimesOptions.onlineNoThrottlingXPerSecond,
          offlineSlowHashingXPerSecond: guesses / attackTimesOptions.offlineSlowHashingXPerSecond,
          offlineFastHashingXPerSecond: guesses / attackTimesOptions.offlineFastHashingXPerSecond
        };
      }
      guessesToScore(guesses) {
        const scoringOptions = this.options.timeEstimationValues.scoring;
        const DELTA = 5;
        if (guesses < scoringOptions[0] + DELTA) {
          // risky password: "too guessable"
          return 0;
        }
        if (guesses < scoringOptions[1] + DELTA) {
          // modest protection from throttled online attacks: "very guessable"
          return 1;
        }
        if (guesses < scoringOptions[2] + DELTA) {
          // modest protection from unthrottled online attacks: "somewhat guessable"
          return 2;
        }
        if (guesses < scoringOptions[3] + DELTA) {
          // modest protection from offline attacks: "safely unguessable"
          // assuming a salted, slow hash function like bcrypt, scrypt, PBKDF2, argon, etc
          return 3;
        }
        // strong protection from offline attacks under same scenario: "very unguessable"
        return 4;
      }
      displayTime(seconds) {
        let displayStr = 'centuries';
        let base = null;
        const timeKeys = Object.keys(times);
        const foundIndex = timeKeys.findIndex(time => seconds < times[time]);
        if (foundIndex > -1) {
          displayStr = timeKeys[foundIndex - 1];
          if (foundIndex !== 0) {
            base = Math.round(seconds / times[displayStr]);
          } else {
            displayStr = 'ltSecond';
          }
        }
        return {
          base,
          displayStr
        };
      }
      translate(displayStr, value) {
        let key = displayStr;
        if (value !== null && value !== 1) {
          key += 's';
        }
        const {
          timeEstimation
        } = this.options.translations;
        const translation = timeEstimation[key];
        if (typeof translation === 'function') {
          return translation(value);
        }
        return translation.replace('{base}', `${value}`);
      }
    }

    var bruteforceMatcher = () => {
      return null;
    };

    var dateMatcher = options => {
      return {
        warning: options.translations.warnings.dates,
        suggestions: [options.translations.suggestions.dates]
      };
    };

    const getDictionaryWarningPassword = (options, match, isSoleMatch) => {
      let warning = null;
      if (isSoleMatch && !match.l33t && !match.reversed) {
        if (match.rank <= 10) {
          warning = options.translations.warnings.topTen;
        } else if (match.rank <= 100) {
          warning = options.translations.warnings.topHundred;
        } else {
          warning = options.translations.warnings.common;
        }
      } else if (match.guessesLog10 <= 4) {
        warning = options.translations.warnings.similarToCommon;
      }
      return warning;
    };
    const getDictionaryWarningWikipedia = (options, match, isSoleMatch) => {
      let warning = null;
      if (isSoleMatch) {
        warning = options.translations.warnings.wordByItself;
      }
      return warning;
    };
    const getDictionaryWarningNames = (options, match, isSoleMatch) => {
      if (isSoleMatch) {
        return options.translations.warnings.namesByThemselves;
      }
      return options.translations.warnings.commonNames;
    };
    const getDictionaryWarning = (options, match, isSoleMatch) => {
      const dictName = match.dictionaryName;
      const isAName = dictName.toLowerCase().includes('lastnames') || dictName.toLowerCase().includes('firstnames') || dictName.toLowerCase().includes('names');
      if (dictName.includes('passwords')) {
        return getDictionaryWarningPassword(options, match, isSoleMatch);
      }
      if (dictName.includes('wikipedia')) {
        return getDictionaryWarningWikipedia(options, match, isSoleMatch);
      }
      if (isAName) {
        return getDictionaryWarningNames(options, match, isSoleMatch);
      }
      if (dictName.includes('userInputs')) {
        return options.translations.warnings.userInputs;
      }
      return null;
    };
    var dictionaryMatcher = (options, match, isSoleMatch) => {
      const warning = getDictionaryWarning(options, match, isSoleMatch);
      const suggestions = [];
      const word = match.token;
      if (word.match(START_UPPER)) {
        suggestions.push(options.translations.suggestions.capitalization);
      } else if (word.match(ALL_UPPER_INVERTED) && word.toLowerCase() !== word) {
        suggestions.push(options.translations.suggestions.allUppercase);
      }
      if (match.reversed && countCharacters(match.token) >= 4) {
        suggestions.push(options.translations.suggestions.reverseWords);
      }
      if (match.l33t) {
        suggestions.push(options.translations.suggestions.l33t);
      }
      return {
        warning,
        suggestions
      };
    };

    var regexMatcher = (options, match) => {
      if (match.regexName === 'recentYear') {
        return {
          warning: options.translations.warnings.recentYears,
          suggestions: [options.translations.suggestions.recentYears, options.translations.suggestions.associatedYears]
        };
      }
      return {
        warning: null,
        suggestions: []
      };
    };

    var repeatMatcher = (options, match) => {
      let warning = options.translations.warnings.extendedRepeat;
      if (countCharacters(match.baseToken) === 1) {
        warning = options.translations.warnings.simpleRepeat;
      }
      return {
        warning,
        suggestions: [options.translations.suggestions.repeated]
      };
    };

    var sequenceMatcher = options => {
      return {
        warning: options.translations.warnings.sequences,
        suggestions: [options.translations.suggestions.sequences]
      };
    };

    var spatialMatcher = (options, match) => {
      let warning = options.translations.warnings.keyPattern;
      if (match.turns === 1) {
        warning = options.translations.warnings.straightRow;
      }
      return {
        warning,
        suggestions: [options.translations.suggestions.longerKeyboardPattern]
      };
    };

    var separatorMatcher = () => {
      // no suggestions
      return null;
    };

    var wordSequenceMatcher = (options, match) => {
      if (match.pattern !== 'wordSequence') {
        return null;
      }
      if (match.dictionaryName === 'userInputs') {
        return {
          warning: options.translations.warnings.userInputs,
          suggestions: [options.translations.suggestions.useWords]
        };
      }
      let warning = null;
      const suggestions = [];
      // Warning for common word sequences
      if (match.wordCount >= 3) {
        warning = options.translations.warnings.sequences;
      }
      // Suggestions based on sequence characteristics
      if (match.ascending) {
        suggestions.push(options.translations.suggestions.sequences);
      } else {
        suggestions.push(options.translations.suggestions.anotherWord);
      }
      if (match.wordCount > 2) {
        suggestions.push(options.translations.suggestions.useWords);
      }
      return {
        warning,
        suggestions
      };
    };

    const createFeedback = suggestions => ({
      warning: null,
      suggestions: suggestions !== null && suggestions !== void 0 ? suggestions : []
    });
    /*
     * -------------------------------------------------------------------------------
     *  Generate feedback ---------------------------------------------------------------
     * -------------------------------------------------------------------------------
     */
    class Feedback {
      constructor(options) {
        this.options = options;
        this.matchers = {};
        this.matchers = {
          bruteforce: bruteforceMatcher,
          date: dateMatcher,
          dictionary: dictionaryMatcher,
          regex: regexMatcher,
          repeat: repeatMatcher,
          sequence: sequenceMatcher,
          spatial: spatialMatcher,
          separator: separatorMatcher,
          wordSequence: wordSequenceMatcher
        };
        Object.entries(this.options.matchers).forEach(([key, matcher]) => {
          if (matcher.feedback) {
            this.matchers[key] = matcher.feedback;
          }
        });
      }
      getFeedback(score, sequence) {
        if (sequence.length === 0) {
          return createFeedback([this.options.translations.suggestions.useWords, this.options.translations.suggestions.noNeed]);
        }
        if (score > 2) {
          return createFeedback();
        }
        const extraFeedback = this.options.translations.suggestions.anotherWord;
        const longestMatch = this.getLongestMatch(sequence);
        let feedback = this.getMatchFeedback(longestMatch, sequence.length === 1);
        if (feedback !== null && feedback !== undefined) {
          feedback.suggestions.unshift(extraFeedback);
        } else {
          feedback = createFeedback([extraFeedback]);
        }
        return feedback;
      }
      getLongestMatch(sequence) {
        let longestMatch = sequence[0];
        let longestLength = countCharacters(longestMatch.token);
        // ignore first entry
        for (let i = 1; i < sequence.length; i += 1) {
          const match = sequence[i];
          const length = countCharacters(match.token);
          if (length > longestLength) {
            longestMatch = match;
            longestLength = length;
          }
        }
        return longestMatch;
      }
      getMatchFeedback(match, isSoleMatch) {
        if (this.matchers[match.pattern]) {
          return this.matchers[match.pattern](this.options, match, isSoleMatch);
        }
        return createFeedback();
      }
    }

    var l33tTable = {
      a: ['4', '@'],
      b: ['8'],
      c: ['(', '{', '[', '<'],
      d: ['6', '|)'],
      e: ['3'],
      f: ['#'],
      g: ['6', '9', '&'],
      h: ['#', '|-|'],
      i: ['1', '!', '|'],
      k: ['<', '|<'],
      l: ['!', '1', '|', '7'],
      m: ['^^', 'nn', '2n', '/\\\\/\\\\'],
      n: ['//'],
      o: ['0', '()'],
      q: ['9'],
      u: ['|_|'],
      s: ['$', '5'],
      t: ['+', '7'],
      v: ['<', '>', '/'],
      w: ['^/', 'uu', 'vv', '2u', '2v', '\\\\/\\\\/'],
      x: ['%', '><'],
      z: ['2']
    };

    var translationKeys = {
      warnings: {
        straightRow: 'straightRow',
        keyPattern: 'keyPattern',
        simpleRepeat: 'simpleRepeat',
        extendedRepeat: 'extendedRepeat',
        sequences: 'sequences',
        recentYears: 'recentYears',
        dates: 'dates',
        topTen: 'topTen',
        topHundred: 'topHundred',
        common: 'common',
        similarToCommon: 'similarToCommon',
        wordByItself: 'wordByItself',
        namesByThemselves: 'namesByThemselves',
        commonNames: 'commonNames',
        userInputs: 'userInputs',
        pwned: 'pwned'
      },
      suggestions: {
        l33t: 'l33t',
        reverseWords: 'reverseWords',
        allUppercase: 'allUppercase',
        capitalization: 'capitalization',
        dates: 'dates',
        recentYears: 'recentYears',
        associatedYears: 'associatedYears',
        sequences: 'sequences',
        repeated: 'repeated',
        longerKeyboardPattern: 'longerKeyboardPattern',
        anotherWord: 'anotherWord',
        useWords: 'useWords',
        noNeed: 'noNeed',
        pwned: 'pwned'
      },
      timeEstimation: {
        ltSecond: 'ltSecond',
        second: 'second',
        seconds: 'seconds',
        minute: 'minute',
        minutes: 'minutes',
        hour: 'hour',
        hours: 'hours',
        day: 'day',
        days: 'days',
        month: 'month',
        months: 'months',
        year: 'year',
        years: 'years',
        centuries: 'centuries'
      }
    };

    class TrieNode {
      constructor(parents = []) {
        this.parents = parents;
        this.children = new Map();
      }
      addSub(key, ...subs) {
        const firstChar = key.charAt(0);
        if (!this.children.has(firstChar)) {
          this.children.set(firstChar, new TrieNode([...this.parents, firstChar]));
        }
        let cur = this.children.get(firstChar);
        for (let i = 1; i < key.length; i += 1) {
          const c = key.charAt(i);
          if (!cur.hasChild(c)) {
            cur.addChild(c);
          }
          cur = cur.getChild(c);
        }
        cur.subs = (cur.subs || []).concat(subs);
        return this;
      }
      getChild(child) {
        return this.children.get(child);
      }
      isTerminal() {
        return !!this.subs;
      }
      addChild(child) {
        if (!this.hasChild(child)) {
          this.children.set(child, new TrieNode([...this.parents, child]));
        }
      }
      hasChild(child) {
        return this.children.has(child);
      }
    }

    // the rank of each word, from 1. A duplicate word keeps its last rank.
    const buildRankedDictionary = list => {
      const result = {};
      list.forEach((word, index) => {
        result[word] = index + 1;
      });
      return result;
    };
    const getMaxWordSize = list => {
      // do not use Math.max(...data) because it can result in max stack size error because every entry will be used as an argument
      return list.reduce((max, word) => Math.max(max, word.toString().length), 0);
    };
    const sanitizeUserInputs = list => {
      const sanitizedInputs = [];
      list.forEach(input => {
        const inputType = typeof input;
        if (inputType === 'string' || inputType === 'number' || inputType === 'boolean') {
          sanitizedInputs.push(toLowerCase(input.toString()));
        }
      });
      return sanitizedInputs;
    };
    const createUserInputsOptions = dictionary => {
      const sanitizedInputs = dictionary ? sanitizeUserInputs(dictionary) : [];
      // of the inputs as given, like it always was
      const maxWordSize = dictionary ? getMaxWordSize(dictionary) : 0;
      let rankedDictionary;
      return {
        wordIndex: new WordIndex([{
          name: 'userInputs',
          words: sanitizedInputs
        }]),
        get rankedDictionary() {
          rankedDictionary !== null && rankedDictionary !== void 0 ? rankedDictionary : rankedDictionary = buildRankedDictionary(sanitizedInputs);
          return rankedDictionary;
        },
        rankedDictionaryMaxWordSize: maxWordSize
      };
    };

    var l33tTableToTrieNode = (l33tTable, triNode) => {
      Object.entries(l33tTable).forEach(([letter, substitutions]) => {
        substitutions.forEach(substitution => {
          triNode.addSub(substitution, letter);
        });
      });
      return triNode;
    };

    var getL33tSubstitutions = l33tTable => {
      const bySubstitution = new Map();
      Object.entries(l33tTable).forEach(([letter, substitutions]) => {
        substitutions.forEach(substitution => {
          // an empty substitution never matches a character
          if (substitution === '') {
            return;
          }
          let entry = bySubstitution.get(substitution);
          if (!entry) {
            entry = {
              substitution,
              letters: [],
              lettersLower: []
            };
            bySubstitution.set(substitution, entry);
          }
          // listed twice for a letter it would be walked twice
          if (!entry.letters.includes(letter)) {
            entry.letters.push(letter);
            entry.lettersLower.push(toLowerCase(letter));
          }
        });
      });
      const result = new Map();
      bySubstitution.forEach(entry => {
        const firstCharacter = entry.substitution.charAt(0);
        const entries = result.get(firstCharacter) || [];
        entries.push(entry);
        result.set(firstCharacter, entries);
      });
      result.forEach(entries => entries.sort((first, second) => second.substitution.length - first.substitution.length));
      return result;
    };

    const checkL33tTable = l33tTable => {
      if (typeof l33tTable !== 'object' || l33tTable === null) {
        throw new Error('l33tTable must be an object');
      }
      Object.values(l33tTable).forEach(substitutions => {
        if (!Array.isArray(substitutions)) {
          throw new Error('l33tTable substitutions must be an array');
        }
        substitutions.forEach(substitution => {
          if (typeof substitution !== 'string') {
            throw new Error('l33tTable substitutions must be strings');
          }
        });
      });
    };
    const checkDictionary = dictionary => {
      if (typeof dictionary !== 'object' || dictionary === null) {
        throw new Error('dictionary must be an object');
      }
      Object.values(dictionary).forEach(list => {
        if (!Array.isArray(list)) {
          throw new Error('dictionary list must be an array');
        }
        list.forEach(el => {
          if (typeof el !== 'string' && typeof el !== 'number') {
            throw new Error('dictionary entries must be strings or numbers');
          }
        });
      });
    };
    const checkGraphs = graphs => {
      if (typeof graphs !== 'object' || graphs === null) {
        throw new Error('graphs must be an object');
      }
      Object.values(graphs).forEach(graph => {
        if (typeof graph !== 'object' || graph === null) {
          throw new Error('graph must be an object');
        }
        Object.values(graph).forEach(adjacencies => {
          if (!Array.isArray(adjacencies)) {
            throw new Error('graph adjacencies must be an array');
          }
          adjacencies.forEach(adjacency => {
            if (typeof adjacency !== 'string' && adjacency !== null) {
              throw new Error('graph adjacency must be a string or null');
            }
          });
        });
      });
    };
    const checkUseLevenshteinDistance = useLevenshteinDistance => {
      if (typeof useLevenshteinDistance !== 'boolean') {
        throw new Error('useLevenshteinDistance must be a boolean');
      }
    };
    const checkLevenshteinThreshold = levenshteinThreshold => {
      if (typeof levenshteinThreshold !== 'number' || levenshteinThreshold < 0) {
        throw new Error('levenshteinThreshold must be a non-negative number');
      }
    };
    const checkL33tMaxSubstitutions = l33tMaxSubstitutions => {
      if (typeof l33tMaxSubstitutions !== 'number' || l33tMaxSubstitutions < 0) {
        throw new Error('l33tMaxSubstitutions must be a non-negative number');
      }
    };
    const checkMaxLength = maxLength => {
      if (typeof maxLength !== 'number' || maxLength < 0) {
        throw new Error('maxLength must be a non-negative number');
      }
    };
    const checkMatcher = (name, matcher) => {
      if (typeof name !== 'string') {
        throw new Error('matcher name must be a string');
      }
      if (typeof matcher !== 'object' || matcher === null) {
        throw new Error(`matcher ${name} must be an object`);
      }
      if (typeof matcher.feedback !== 'function') {
        throw new Error(`matcher ${name}.feedback must be a function`);
      }
      if (typeof matcher.scoring !== 'function') {
        throw new Error(`matcher ${name}.scoring must be a function`);
      }
      if (typeof matcher.Matching !== 'function') {
        throw new Error(`matcher ${name}.Matching must be a constructor`);
      }
    };
    const checkCustomMatchers = customMatchers => {
      if (typeof customMatchers !== 'object' || customMatchers === null) {
        throw new Error('customMatchers must be an object');
      }
    };
    // returns the missing or invalid keys, a missing type is returned as a whole
    const checkCustomTranslations = translations => {
      const invalidKeys = [];
      Object.keys(translationKeys).forEach(type => {
        if (type in translations) {
          const translationType = type;
          Object.keys(translationKeys[translationType]).forEach(key => {
            const translation = translations[translationType][key];
            if (typeof translation !== 'string' && typeof translation !== 'function') {
              invalidKeys.push(`${type}.${key}`);
            }
          });
        } else {
          invalidKeys.push(type);
        }
      });
      return invalidKeys;
    };
    const checkTimeEstimationValues = timeEstimationValues => {
      if (typeof timeEstimationValues !== 'object' || timeEstimationValues === null) {
        throw new Error('timeEstimationValues must be an object');
      }
      Object.keys(timeEstimationValuesDefaults).forEach(key => {
        if (!(key in timeEstimationValues)) {
          throw new Error(`timeEstimationValues.${key} is required`);
        }
        const data = timeEstimationValues[key];
        if (typeof data !== 'object' || data === null) {
          throw new Error(`timeEstimationValues.${key} must be an object`);
        }
        Object.keys(timeEstimationValuesDefaults[key]).forEach(subKey => {
          if (!(subKey in data)) {
            throw new Error(`timeEstimationValues.${key}.${subKey} is required`);
          }
          const value = data[subKey];
          if (typeof value !== 'number') {
            throw new Error(`timeEstimationValues.${key}.${subKey} must be a number`);
          }
          if (value < timeEstimationValuesDefaults[key][subKey]) {
            throw new Error('Time estimation values are not to be allowed to be less than default');
          }
        });
      });
    };

    class Options {
      constructor(options = {}, customMatchers = {}) {
        this.matchers = {};
        this.l33tTable = l33tTable;
        // only for the fully substituted passwords checked with levenshtein, empty
        // without it
        this.trieNodeRoot = new TrieNode();
        this.l33tSubstitutions = getL33tSubstitutions(l33tTable);
        this.dictionary = {
          userInputs: []
        };
        // the words of all dictionaries, empty until the dictionary option is set
        this.wordIndex = new WordIndex();
        this.dictionaryMaxWordSizes = {};
        this.translations = translationKeys;
        this.graphs = {};
        this.useLevenshteinDistance = false;
        this.levenshteinThreshold = 2;
        this.l33tMaxSubstitutions = 100;
        this.maxLength = 256;
        this.wordSequenceNames = ['cardinalNumbers', 'ordinalNumbers', 'daysOfWeek', 'months', 'seasons', 'timePeriods', 'rainbowColors', 'directions', 'intermediateDirections', 'sizeProgression', 'militaryAlphabet', 'planets', 'zodiacSigns', 'chineseZodiac', 'userInputs'];
        this.timeEstimationValues = {
          scoring: {
            ...timeEstimationValuesDefaults.scoring
          },
          attackTime: {
            ...timeEstimationValuesDefaults.attackTime
          }
        };
        checkCustomMatchers(customMatchers);
        this.setOptions(options);
        Object.entries(customMatchers).forEach(([name, matcher]) => {
          checkMatcher(name, matcher);
          this.addMatcher(name, matcher);
        });
      }
      /**
       * @deprecated The dictionaries are matched with `wordIndex`. This is only
       * built when read and will be removed in the next major version.
       */
      get rankedDictionaries() {
        if (this.cachedRankedDictionaries === undefined) {
          const rankedDictionaries = {};
          Object.keys(this.dictionary).forEach(name => {
            rankedDictionaries[name] = buildRankedDictionary(this.dictionary[name]);
          });
          this.cachedRankedDictionaries = rankedDictionaries;
        }
        return this.cachedRankedDictionaries;
      }
      /**
       * @deprecated Use `dictionaryMaxWordSizes`, will be removed in the next
       * major version.
       */
      get rankedDictionariesMaxWordSize() {
        return this.dictionaryMaxWordSizes;
      }
      isWordSequence(key) {
        return this.wordSequenceNames.some(name => isDictionaryNamed(key, name));
      }
      // eslint-disable-next-line max-statements,complexity
      setOptions(options = {}) {
        if (options.l33tTable) {
          checkL33tTable(options.l33tTable);
          this.l33tTable = options.l33tTable;
          this.l33tSubstitutions = getL33tSubstitutions(options.l33tTable);
        }
        if (options.dictionary) {
          checkDictionary(options.dictionary);
          this.dictionary = options.dictionary;
          this.setWordIndex();
        }
        if (options.translations) {
          this.setTranslations(options.translations);
        }
        if (options.graphs) {
          checkGraphs(options.graphs);
          this.graphs = options.graphs;
        }
        if (options.useLevenshteinDistance !== undefined) {
          checkUseLevenshteinDistance(options.useLevenshteinDistance);
          this.useLevenshteinDistance = options.useLevenshteinDistance;
        }
        if (this.useLevenshteinDistance) {
          this.trieNodeRoot = l33tTableToTrieNode(this.l33tTable, new TrieNode());
        }
        if (options.levenshteinThreshold !== undefined) {
          checkLevenshteinThreshold(options.levenshteinThreshold);
          this.levenshteinThreshold = options.levenshteinThreshold;
        }
        if (options.l33tMaxSubstitutions !== undefined) {
          checkL33tMaxSubstitutions(options.l33tMaxSubstitutions);
          this.l33tMaxSubstitutions = options.l33tMaxSubstitutions;
        }
        if (options.maxLength !== undefined) {
          checkMaxLength(options.maxLength);
          this.maxLength = options.maxLength;
        }
        if (options.timeEstimationValues !== undefined) {
          checkTimeEstimationValues(options.timeEstimationValues);
          this.timeEstimationValues = {
            scoring: {
              ...options.timeEstimationValues.scoring
            },
            attackTime: {
              ...options.timeEstimationValues.attackTime
            }
          };
        }
      }
      setTranslations(translations) {
        const invalidKeys = checkCustomTranslations(translations);
        if (invalidKeys.length > 0) {
          throw new Error(`Invalid translations object, missing or invalid keys: ${invalidKeys.join(', ')}`);
        }
        this.translations = translations;
      }
      setWordIndex() {
        const dictionaryMaxWordSizes = {};
        const names = Object.keys(this.dictionary);
        names.forEach(name => {
          dictionaryMaxWordSizes[name] = getMaxWordSize(this.dictionary[name]);
        });
        this.wordIndex = new WordIndex(names.map(name => ({
          name,
          words: this.dictionary[name]
        })));
        this.dictionaryMaxWordSizes = dictionaryMaxWordSizes;
      }
      getUserInputsOptions(dictionary) {
        const {
          cachedUserInputs
        } = this;
        const isCacheHit = this.cachedUserInputsOptions !== undefined && (dictionary === undefined ? cachedUserInputs === undefined : (cachedUserInputs === null || cachedUserInputs === void 0 ? void 0 : cachedUserInputs.length) === dictionary.length && cachedUserInputs.every((value, index) => value === dictionary[index]));
        if (isCacheHit) {
          return this.cachedUserInputsOptions;
        }
        const userInputsOptions = createUserInputsOptions(dictionary);
        // Snapshot the contents rather than keeping the caller's array reference,
        // so a later mutate-and-reuse of the same array is detected as a cache miss.
        this.cachedUserInputs = dictionary ? [...dictionary] : undefined;
        this.cachedUserInputsOptions = userInputsOptions;
        return userInputsOptions;
      }
      addMatcher(name, matcher) {
        if (this.matchers[name]) {
          console.info(`Matcher ${name} already exists`);
        } else {
          this.matchers[name] = matcher;
        }
      }
    }

    /**
     * @link https://davidwalsh.name/javascript-debounce-function
     * @param func needs to implement a function which is debounced
     * @param wait how long do you want to wait till the previous declared function is executed
     * @param isImmediate defines if you want to execute the function on the first execution or the last execution inside the time window. `true` for first and `false` for last.
     */
    var debounce = (func, wait, isImmediate) => {
      let timeout;
      return function debounce(...args) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const context = this;
        const later = () => {
          timeout = undefined;
          if (!isImmediate) {
            func.apply(context, args);
          }
        };
        const shouldCallNow = isImmediate && !timeout;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(later, wait);
        if (shouldCallNow) {
          func.apply(context, args);
          return;
        }
        return undefined;
      };
    };

    const time = () => new Date().getTime();
    class ZxcvbnFactory {
      constructor(options = {}, customMatchers = {}) {
        this.options = new Options(options, customMatchers);
        this.scoring = new Scoring(this.options);
        this.matching = new Matching(this.options);
        this.feedback = new Feedback(this.options);
        this.timeEstimates = new TimeEstimates(this.options);
      }
      estimateAttackTimes(guesses) {
        return this.timeEstimates.estimateAttackTimes(guesses);
      }
      getFeedback(score, sequence) {
        return this.feedback.getFeedback(score, sequence);
      }
      createReturnValue(resolvedMatches, password, start) {
        const matchSequence = this.scoring.mostGuessableMatchSequence(password, resolvedMatches);
        const calcTime = time() - start;
        const attackTimes = this.estimateAttackTimes(matchSequence.guesses);
        return {
          calcTime,
          ...matchSequence,
          ...attackTimes,
          feedback: this.getFeedback(attackTimes.score, matchSequence.sequence)
        };
      }
      getMatches(password, userInputs) {
        const userInputsOptions = this.options.getUserInputsOptions(userInputs);
        return this.matching.match(password, userInputsOptions);
      }
      check(password, userInputs) {
        const {
          reducedPassword,
          start
        } = this.prepareCheck(password);
        const matches = this.getMatches(reducedPassword, userInputs);
        if (matches instanceof Promise) {
          throw new Error('You are using a Promised matcher, please use `checkAsync` for it.');
        }
        return this.createReturnValue(matches, reducedPassword, start);
      }
      async checkAsync(password, userInputs) {
        const {
          reducedPassword,
          start
        } = this.prepareCheck(password);
        const matches = await this.getMatches(reducedPassword, userInputs);
        return this.createReturnValue(matches, reducedPassword, start);
      }
      prepareCheck(password) {
        let end = this.options.maxLength;
        // maxLength counts UTF-16 code units. If the cut lands inside a surrogate
        // pair (eg. an emoji), drop that whole character instead of half of it.
        if (isSurrogatePairAt(password, end - 1)) {
          end -= 1;
        }
        return {
          reducedPassword: password.substring(0, end),
          start: time()
        };
      }
    }

    exports.MatcherBaseClass = MatcherBaseClass;
    exports.Options = Options;
    exports.ZxcvbnFactory = ZxcvbnFactory;
    exports.debounce = debounce;

    return exports;

})({});
//# sourceMappingURL=zxcvbn-ts.js.map

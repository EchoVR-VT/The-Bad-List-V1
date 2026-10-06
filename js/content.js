import { round, score } from './score.js';

/**
 * Path to directory containing list.json and all levels
 */
const dir = './data';

/**
 * Load the level list and all level files.
 *
 * Returns:
 * [
 *     [level, null],
 *     [null, errorPath],
 *     ...
 * ]
 */
export async function fetchList() {
    let listResult;

    try {
        listResult = await fetch(`${dir}/list.json`);
    } catch (error) {
        console.error('Failed to fetch list.json.', error);
        return null;
    }

    try {
        const list = await listResult.json();

        if (!Array.isArray(list)) {
            console.error('list.json does not contain an array.');
            return null;
        }

        return await Promise.all(
            list.map(async (path, rank) => {
                try {
                    const levelResult = await fetch(`${dir}/${path}.json`);

                    if (!levelResult.ok) {
                        throw new Error(
                            `HTTP ${levelResult.status} ${levelResult.statusText}`,
                        );
                    }

                    const level = await levelResult.json();

                    if (!level || typeof level !== 'object') {
                        throw new Error('Level data is not an object.');
                    }

                    // Make sure records is always an array.
                    if (!Array.isArray(level.records)) {
                        console.warn(
                            `Level "${path}" has no valid records array. Using an empty array.`,
                        );

                        level.records = [];
                    }

                    // Only sort valid records.
                    level.records = level.records
                        .filter((record) => {
                            if (!record || typeof record !== 'object') {
                                console.warn(
                                    `Skipping invalid record in level "${path}".`,
                                );
                                return false;
                            }

                            return true;
                        })
                        .sort(
                            (a, b) =>
                                (Number(b.percent) || 0) -
                                (Number(a.percent) || 0),
                        );

                    return [
                        {
                            ...level,
                            path,
                        },
                        null,
                    ];
                } catch (error) {
                    console.error(
                        `Failed to load level #${rank + 1} ${path}.`,
                        error,
                    );

                    return [null, path];
                }
            }),
        );
    } catch (error) {
        console.error('Failed to load list.json.', error);
        return null;
    }
}

/**
 * Load editors.json.
 */
export async function fetchEditors() {
    try {
        const editorsResults = await fetch(`${dir}/editors.json`);

        if (!editorsResults.ok) {
            throw new Error(
                `HTTP ${editorsResults.status} ${editorsResults.statusText}`,
            );
        }

        const editors = await editorsResults.json();

        return editors;
    } catch (error) {
        console.error('Failed to load editors.json.', error);
        return null;
    }
}

/**
 * Build the leaderboard.
 */
export async function fetchLeaderboard() {
    const list = await fetchList();

    if (!list) {
        return [[], ['list.json']];
    }

    const scoreMap = {};
    const errs = [];

    list.forEach(([level, err], rank) => {
        // Level failed to load.
        if (err) {
            errs.push(err);
            return;
        }

        // Extra protection in case a malformed level somehow gets here.
        if (!level || typeof level !== 'object') {
            console.warn(`Skipping invalid level at rank ${rank + 1}.`);
            return;
        }

        /*
         * ------------------------------------------------------------
         * Verification
         * ------------------------------------------------------------
         */

        if (
            typeof level.verifier !== 'string' ||
            level.verifier.trim() === ''
        ) {
            console.warn(
                `Skipping verification for "${level.name}" because verifier is missing or invalid.`,
                level,
            );
        } else {
            const verifierName = level.verifier.trim();

            const verifier =
                Object.keys(scoreMap).find(
                    (u) =>
                        typeof u === 'string' &&
                        u.toLowerCase() === verifierName.toLowerCase(),
                ) || verifierName;

            scoreMap[verifier] ??= {
                verified: [],
                completed: [],
                progressed: [],
            };

            const { verified } = scoreMap[verifier];

            verified.push({
                rank: rank + 1,
                level: level.name ?? 'Unknown Level',
                score: score(
                    rank + 1,
                    100,
                    Number(level.percentToQualify) || 100,
                ),
                link: level.verification ?? '',
            });
        }

        /*
         * ------------------------------------------------------------
         * Records
         * ------------------------------------------------------------
         */

        if (!Array.isArray(level.records)) {
            return;
        }

        level.records.forEach((record) => {
            // Ignore null, undefined, or non-object records.
            if (!record || typeof record !== 'object') {
                console.warn(
                    `Skipping invalid record in level "${level.name}".`,
                    record,
                );
                return;
            }

            // This is the important protection against:
            // Cannot read properties of undefined (reading 'toLowerCase')
            if (
                typeof record.user !== 'string' ||
                record.user.trim() === ''
            ) {
                console.warn(
                    `Skipping record without a valid user in level "${level.name}".`,
                    record,
                );
                return;
            }

            const username = record.user.trim();

            const user =
                Object.keys(scoreMap).find(
                    (u) =>
                        typeof u === 'string' &&
                        u.toLowerCase() === username.toLowerCase(),
                ) || username;

            scoreMap[user] ??= {
                verified: [],
                completed: [],
                progressed: [],
            };

            const { completed, progressed } = scoreMap[user];

            const percent = Number(record.percent);

            // Ignore records with an invalid percentage.
            if (!Number.isFinite(percent)) {
                console.warn(
                    `Skipping record with invalid percent in level "${level.name}".`,
                    record,
                );
                return;
            }

            /*
             * --------------------------------------------------------
             * Completed
             * --------------------------------------------------------
             */

            if (percent === 100) {
                completed.push({
                    rank: rank + 1,
                    level: level.name ?? 'Unknown Level',
                    score: score(
                        rank + 1,
                        100,
                        Number(level.percentToQualify) || 100,
                    ),
                    link: record.link ?? '',
                });

                return;
            }

            /*
             * --------------------------------------------------------
             * Progressed
             * --------------------------------------------------------
             */

            progressed.push({
                rank: rank + 1,
                level: level.name ?? 'Unknown Level',
                percent,
                score: score(
                    rank + 1,
                    percent,
                    Number(level.percentToQualify) || 100,
                ),
                link: record.link ?? '',
            });
        });
    });

    /*
     * ------------------------------------------------------------
     * Convert scoreMap into leaderboard array
     * ------------------------------------------------------------
     */

    const res = Object.entries(scoreMap).map(([user, scores]) => {
        const {
            verified = [],
            completed = [],
            progressed = [],
        } = scores;

        const total = [verified, completed, progressed]
            .flat()
            .reduce((prev, cur) => prev + (Number(cur.score) || 0), 0);

        return {
            user,
            total: round(total),
            verified,
            completed,
            progressed,
        };
    });

    /*
     * ------------------------------------------------------------
     * Sort by total score
     * ------------------------------------------------------------
     */

    res.sort((a, b) => b.total - a.total);

    return [res, errs];
}

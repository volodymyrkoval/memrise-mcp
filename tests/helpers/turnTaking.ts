/**
 * How fairly processes sharing one pacer took turns. `owners` lists who started each request, in
 * start order. Returns the most requests one owner started in a row while another owner still had
 * a request to start later; runs at the very end, after the others are done, do not count.
 */
export function longestRunWhileOthersWait(owners: readonly unknown[]): number {
  let longest = 0;
  let run = 0;
  owners.forEach((owner, i) => {
    run = i > 0 && owners[i - 1] === owner ? run + 1 : 1;
    const othersWaiting = owners.slice(i + 1).some((later) => later !== owner);
    if (othersWaiting) longest = Math.max(longest, run);
  });
  return longest;
}

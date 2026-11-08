---
layout: page
title: If Only They Voted
permalink: /projects/us-elections/
description: Who would have won U.S. elections from 2012 to 2024 if only some voters were counted, for president, Senate, House and governor.
img: assets/img/us-elections/og.png
og_image: /assets/img/us-elections/og.png
importance: 8
category: fun
project_intro: true
repository:
  - vltanh/us-elections
---

Every election, maps go around showing who would have won "if only women voted" or "if only Gen Z voted". They usually color whole states from exit polls and stop at the presidency, with nothing to say about House districts. This project rebuilds those maps from survey and census data for every federal and governor race from 2012 to 2024.

You mark the groups to count by race and ethnicity, education, family income, gender and age. Every state and House district is then tallied again using only those voters' ballots. Marks within one category widen the count (Black or Hispanic voters); marks across categories narrow it (Hispanic women under 30).

<div class="row justify-content-center">
    <div class="col-sm-10 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/us-elections/og.png" title="If only women voted, 2024" class="img-fluid rounded z-depth-1" caption="Counting only women in 2024: Harris wins 309 to 229. The ballot on the left picks who counts; click any state to see it district by district." %}
    </div>
</div>

<p style="text-align:center; margin-top:1rem;"><a href="/us-elections/">open the map &rarr;</a></p>

## How the count is made

Each race needs two things: who voted, and how each kind of voter voted. The page splits voters into 800 groups (five race and ethnicity categories, four education levels, five income brackets, two genders, four age bands) and estimates both for every group in every state.

For who voted, the Census Bureau's November voting survey (CPS) gives each state's voters by group. A House district takes its state's electorate and reshapes it to the district's own population from the American Community Survey, weighted by how often each group turns out.

For how they voted, the Cooperative Election Study interviews about 60,000 Americans each cycle and checks their turnout against voter files. A regression on those verified voters estimates each group's vote for the Democratic or the Republican side, with patterns that differ by state and region, so that white voters in Mississippi and in Vermont don't look alike. Surveys disagree about some groups: in 2024 the CES alone put voters under 30 at 64% for Harris, against 60% in Pew Research Center's study of validated voters. National group results are therefore brought in line with Pew's for 2016 to 2024.

Last, each race is shifted so that counting everyone reproduces its certified result. With everyone counted, all 3,644 contests here (states for president, Senate and governor, districts for the House) come out as they really did. Erasing groups then shows what the same electorate would have decided without them.

The map is the usual one, state by state, or district by district for the House. Click a state to see how each of its congressional districts votes: every district becomes a circle placed where it is, sized by the ballots counted there and colored by how those voters chose. Counting only Hispanic voters in Texas, the circles swell along the border and in San Antonio and Houston and shrink to dots in the Panhandle. For the House the circles are the real races. For president, Senate and governor they are estimates: each district's mix of voters plus its lean in House races, adjusted so the districts add up to the statewide result.

<div class="row justify-content-center">
    <div class="col-sm-8 mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/us-elections/texas-hispanic.png" title="Texas, counting only Hispanic voters" class="img-fluid rounded z-depth-1" caption="Texas in 2024, counting only Hispanic voters: each circle is a congressional district, sized by the Hispanic ballots cast there. Trump wins them statewide by 16 points." %}
    </div>
</div>

## A few results from 2024

| counting only       | president             |
| :------------------ | :-------------------- |
| everyone            | Trump 312, Harris 226 |
| women               | Harris 309, Trump 229 |
| men                 | Trump 363, Harris 175 |
| voters under 30     | Harris 418, Trump 120 |
| college graduates   | Harris 376, Trump 162 |
| white non-graduates | Trump 516, Harris 22  |

## Read with care

Every number here is an estimate, and narrow groups in small states rest on few survey respondents. Turnout stays at its actual level: the map counts the ballots each group really cast and does not guess how many more of them might have voted. Only the two-party vote is modeled; independents who were the main opponent of the Republican, like Bernie Sanders, Angus King or Dan Osborn, count on the Democratic side. Maine's and Nebraska's district electors are not modeled, so every state is winner-take-all. Seats with no candidate from one side keep their winner under every filter. In the state close-ups, a House member who ran well ahead of their party pulls the district's estimate for the other races toward that party.

## Data

- Shiro Kuriwaki, [Cumulative CES Common Content](https://doi.org/10.7910/DVN/II2DB6), Harvard Dataverse.
- U.S. Census Bureau, [Current Population Survey Voting and Registration Supplement](https://www.census.gov/topics/public-sector/voting.html), 2012–2024, and the [American Community Survey](https://www.census.gov/programs-surveys/acs) 1-year estimates by congressional district.
- Pew Research Center, [Behind Trump's 2024 Victory, a More Racially and Ethnically Diverse Voter Coalition](https://www.pewresearch.org/politics/2025/06/26/behind-trumps-2024-victory-a-more-racially-and-ethnically-diverse-voter-coalition/), with its detailed tables for 2016–2024.
- Results from the [Federal Election Commission](https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/), the [Clerk of the House](https://history.house.gov/Institution/Election-Statistics/) and the [MIT Election Data and Science Lab](https://electionlab.mit.edu/data); state and district boundaries from the Census Bureau.

## Contributors

Claude Opus 5.5 built the data pipeline and the page, and I directed the work.

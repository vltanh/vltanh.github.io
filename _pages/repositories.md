---
layout: page
permalink: /repositories/
title: repositories
description: code I write, break, and occasionally ship
nav: true
nav_order: 5
---

{% if site.data.repositories.github_users %}

## where to find me

<div class="repositories repositories--users">
  {% for user in site.data.repositories.github_users %}
    {% include repository/repo_user.liquid username=user %}
  {% endfor %}
</div>

{% if site.repo_trophies.enabled %}
{% for user in site.data.repositories.github_users %}
{% if site.data.repositories.github_users.size > 1 %}

### {{ user }}
{% endif %}

<div class="repositories repositories--trophies">
  {% include repository/repo_trophies.liquid username=user %}
</div>

{% endfor %}
{% endif %}
{% endif %}

{% if site.data.repositories.github_repos %}

## things I've built

<div class="repositories repositories--repos">
  {% for repo in site.data.repositories.github_repos %}
    {% include repository/repo.liquid repository=repo %}
  {% endfor %}
</div>
{% endif %}

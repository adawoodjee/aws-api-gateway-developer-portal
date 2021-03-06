// Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { apiGatewayClient } from './api'
import { store } from './state'

/* Catalog and API Utils */

/**
 * 
 * Does all operations to get user data at once.
 * 
 * @param {Boolean} bustCache=true   Ignore the cache and re-make the calls? Defaults to true.
 */
export function updateAllUserData(bustCache = true) {
  return Promise.all([
    updateCatalogAndApisList(bustCache),
    updateSubscriptions(bustCache),
    updateApiKey(bustCache)
  ])
}

/**
 * 
 * Update the catalog for the current user. Both request and response are cached, so unless the cache is busted, this should only ever make one network call.
 * 
 * @param {Boolean} [bustCache=false]   Ignore the cache and re-make the network call. Defaults to false.
 * 
 */
export function updateCatalogAndApisList(bustCache = false) {
  let catalogOrPromise = store.catalog.length ? store.catalog : catalogPromiseCache
  if (!bustCache && catalogOrPromise) return Promise.resolve(catalogOrPromise)

  return catalogPromiseCache = apiGatewayClient()
    .then(apiGatewayClient => apiGatewayClient.get('/catalog', {}, {}, {}))
    .then(({ data = [] }) => (store.catalog = data))
    .catch(() => {
      // catch a failed request and set catalog to a blank array
      return (store.catalog = [])
    })
}
let catalogPromiseCache // WARNING: Don't touch this. Should only be used by updateCatalogAndApisList.

/**
 * Return the API with the provided apiId. Can also provide the special strings "FIRST" or "ANY" to get the first API returned. Can select the api returned as a side-effect.
 * 
 * @param {String} apiId   An apiId or the special strings 'FIRST' or 'ANY'. 'FIRST' and 'ANY' both return the first api encountered.
 * @param {Boolean} [selectIt=false]   If true, sets the found API as the current 'selected' API.
 */
export function getApi(apiId, selectIt = false) {
  return updateCatalogAndApisList()
    .then(() => {
      let thisApi
  
      if (store.apiList.apiGateway.length) {
        if (apiId === 'ANY' || apiId === 'FIRST') {
          thisApi = store.apiList.apiGateway[0]
        }

        else {
          thisApi = store.apiList.apiGateway.find(api => api.id === apiId)
        }

        if (thisApi === undefined) {
          thisApi = store.apiList.generic.find(api => api.id.toString() === apiId)
        }
      }

      if (selectIt) store.api = thisApi

      return thisApi
    })
}

/* Subscription Utils */

/**
 * Fetch and update subscriptions store. Uses caching to determine if it should actually fetch or return the stored result.
 * 
 * @param {Boolean} [bustCache=false]   Ignore the cache and re-make the network call. Defaults to false.
 */
export function updateSubscriptions(bustCache = false) {
  let subscriptionsOrPromise = store.subscriptions.length ? store.subscriptions : subscriptionsPromiseCache
  if (!bustCache && subscriptionsOrPromise) return Promise.resolve(subscriptionsOrPromise)

  return subscriptionsPromiseCache = apiGatewayClient()
    .then(apiGatewayClient => apiGatewayClient.get('/subscriptions', {}, {}, {}))
    .then(({ data }) => (store.subscriptions = data))
}
let subscriptionsPromiseCache // WARNING: Don't touch this. Should only be used by updateCatalogAndApisList.

export function getSubscribedUsagePlan(usagePlanId) {
  return store.subscriptions.find(sub => sub.id === usagePlanId)
}

export function subscribe(usagePlanId) {
  return apiGatewayClient()
    .then(apiGatewayClient => apiGatewayClient.put('/subscriptions/' + usagePlanId, {}, {}))
    .then(() => updateSubscriptions(true))
}

export function unsubscribe(usagePlanId) {
  return apiGatewayClient()
    .then(apiGatewayClient => apiGatewayClient.delete(`/subscriptions/${usagePlanId}`, {}, {}))
    .then(() => updateSubscriptions(true))
}

/**
 * 
 * Fetches and updates the apiKey in the store. Both request and response are cached, so unless the cache is busted, this should only ever make one network call.
 * 
 */
export function updateApiKey(bustCache) {
  let apiKeyOrPromise = store.apiKey ? store.apiKey : apiKeyPromiseCache
  if (!bustCache && apiKeyOrPromise) return Promise.resolve(apiKeyOrPromise)

  return apiGatewayClient()
    .then(apiGatewayClient => apiGatewayClient.get('/apikey', {}, {}, {}))
    .then(({data}) => (store.apiKey = data.value))
}
let apiKeyPromiseCache

export function fetchUsage(usagePlanId) {
  const date = new Date()
  const start = new Date(date.getFullYear(), date.getMonth(), 1).toJSON().split('T')[0]
  const end = new Date().toJSON().split('T')[0]
  return apiGatewayClient()
    .then(apiGatewayClient => apiGatewayClient.get('/subscriptions/' + usagePlanId + '/usage', { start, end }, {}))
}

export function mapUsageByDate(usage, usedOrRemaining) {
  const apiKeyDates = {}
  Object.keys(usage.items).forEach(apiKeyId => {
    apiKeyDates[apiKeyId] = mapApiKeyUsageByDate(usage.items[apiKeyId], usage.startDate, usedOrRemaining)
  })
  
  const dates = {}
  Object.keys(apiKeyDates).forEach((apiKeyId, index) => {
    const apiKeyUsage = apiKeyDates[apiKeyId]
    apiKeyUsage.forEach(dailyUsage => {
      const date = dailyUsage[0]
      const value = dailyUsage[1]
      
      if (!dates[date])
      dates[date] = 0
      dates[date] += value
    })
  })
  
  const usageByDate = Object.keys(dates).sort().map(date => [date, dates[date]])
  
  return usageByDate
}

function mapApiKeyUsageByDate(apiKeyUsage, startDate, usedOrRemaining) {
  const dateParts = startDate.split('-')
  const year = dateParts[0]
  const month = dateParts[1]
  const day = dateParts[2]
  const apiKeyDate = new Date(year, month - 1, day)
  apiKeyDate.setHours(0, 0, 0, 0)
  const usedOrRemainingIndex = usedOrRemaining === 'used'
  ? 0
  : 1
  
  if (apiKeyUsage && !Array.isArray(apiKeyUsage[0]))
  apiKeyUsage = [apiKeyUsage]
  
  return apiKeyUsage.map((usage) => {
    const date = apiKeyDate.setDate(apiKeyDate.getDate())
    const item = [date, usage[usedOrRemainingIndex]]
    apiKeyDate.setDate(apiKeyDate.getDate() + 1)
    return item
  })
}

/* Marketplace integration */

export function confirmMarketplaceSubscription(usagePlanId, token) {
  if (!usagePlanId) {
    return
  }
  
  return apiGatewayClient()
    .then(apiGatewayClient => apiGatewayClient.put('/marketplace-subscriptions/' + usagePlanId, {}, {"token" : token}))
}
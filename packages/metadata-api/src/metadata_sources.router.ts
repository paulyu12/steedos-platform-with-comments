const express = require("express");
const router = express.Router();
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const chalk = require("chalk");
const Fiber = require('fibers');
const _ = require('underscore');

import { requireAuthentication } from '@steedos/core';
import { getMetadataSources } from './metadata/collection';

import { DbManager } from './util/dbManager';
import { getFullName } from '@steedos/metadata-core';

const getSources = async function (req, res) {
    try {
        /* yupeng: 客户端传来的 req.user
        {
            authToken: "apikey,7jFef7xied47TZJyM7a84Vywd9DaoAa0GzjB7D7nnNK",
            spaceId: "61dd2a2cdee73900329ea015",
            userId: "622f79fb66e225001e073ca8",
            name: "Paul",
            username: "18646576880",
            mobile: "18646576880",
            email: undefined,
            utcOffset: 8,
            steedos_id: "622f79fb66e225001e073ca8",
            locale: "zh-cn",
            language: "zh-CN",
            roles: [
                "admin",
            ],
            profile: "admin",
            space: {
                _id: "61dd2a2cdee73900329ea015",
                name: "Yu-Company",
                admins: [
                "622f79fb66e225001e073ca8",
                ],
            },
            spaces: [
                {
                _id: "61dd2a2cdee73900329ea015",
                name: "Yu-Company",
                },
            ],
            company: {
                _id: "5zTXg6Dzcrra5nTm2",
                name: "Yu-Company",
                organization: "5zTXg6Dzcrra5nTm2",
            },
            companies: [
                {
                _id: "5zTXg6Dzcrra5nTm2",
                name: "Yu-Company",
                organization: "5zTXg6Dzcrra5nTm2",
                },
            ],
            organization: {
                _id: "5zTXg6Dzcrra5nTm2",
                name: "Yu-Company",
                fullname: "Yu-Company",
                company_id: "5zTXg6Dzcrra5nTm2",
            },
            organizations: [
                {
                _id: "5zTXg6Dzcrra5nTm2",
                name: "Yu-Company",
                fullname: "Yu-Company",
                company_id: "5zTXg6Dzcrra5nTm2",
                },
            ],
            is_space_admin: true,
            company_id: "5zTXg6Dzcrra5nTm2",
            company_ids: [
                "5zTXg6Dzcrra5nTm2",
            ],
            permission_shares: [
            ],
            is_phone: false,
            is_tablet: false,
            }

        */
        const userSession = req.user;
        const isSpaceAdmin = req.user.is_space_admin;
        // const spaceId = userSession.spaceId;

        let urlParams = req.params;

        // yupeng: urlParams.metadataName = "CustomObject"
        let metadataName = urlParams.metadataName;
        if (!isSpaceAdmin) {
            return res.status(401).send({ status: 'error', message: 'Permission denied' });
        }
        var dbManager = new DbManager(userSession);
        await dbManager.connect();
        const records = await getMetadataSources(dbManager, metadataName);
        await dbManager.close();
        let sources: any = [];
        _.each(records, function (reocrd) {
            sources.push({ fullName: getFullName(metadataName, reocrd), type: metadataName })
        })

        return res.status(200).send(sources);
    } catch (error) {
        console.log(`sources error`, error);
        return res.status(500).send(error.message);
    }
}



router.get('/api/metadata/sources/:metadataName', requireAuthentication, function (req, res) {
    return Fiber(function(){
        return getSources(req, res);
    }).run();;
});



exports.default = router;
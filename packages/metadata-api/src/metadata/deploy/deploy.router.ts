const express = require("express");
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require("path");
const chalk = require("chalk");
const Fiber = require('fibers');

import { DbManager } from '../../util/dbManager'
import { requireAuthentication } from '@steedos/core';
import { jsonToDb } from './jsonToDb';
import { deleteFolderRecursive, SteedosMetadataTypeInfoKeys as TypeInfoKeys } from '@steedos/metadata-core'
import { loadFileToJson } from './fileToJson';

declare var Steedos: any;

const uploadMetadata = async function (req, res) {

    const userSession = req.user;
    const isSpaceAdmin = req.user.is_space_admin;
    const spaceId = userSession.spaceId;
    // const userId = userSession.userId;

    if(!isSpaceAdmin){
        return res.status(401).send({ status: 'error', message: 'Permission denied' });
    }

    // if(!Steedos.hasFeature('metadata_api', spaceId)){
    //     return res.status(403).send({ status: 'error', message: 'Please upgrade the platform license to Enterprise Edition' });
    // }


    // yupeng: req.body.file 是一个 base64 编码之后的 zip 文件
    const dataBuffer = Buffer.from(req.body.file, 'base64');

    //console.log(dataBuffer);

    var tempDFolder = path.join(os.tmpdir(), "steedos-dx");

    if(!fs.existsSync(tempDFolder)){
        fs.mkdirSync(tempDFolder);
    } 

    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "steedos-dx", 'upload-'));

    var zipDir = path.join(tempDir, 'deploy.zip');

    // yupeng: 在服务器上建一个临时目录，先将压缩文件写到临时目录下面的 deploy.zip 文件
    fs.writeFileSync(zipDir, dataBuffer);
    var resMsg = {
        status: '', 
        msg: '',
    };
    
    var dbManager = new DbManager(userSession);
    try {
        /* yupeng: SteedosPackage 返回一个对象，形如
        {
            CustomObject: {
                ...,
                CustomField: {

                },
                CustomPermission: {

                }
            },
            CustomPermissionset: {

            },
            ...
        }
        */
        let SteedosPackage = await loadFileToJson(tempDir);

        // console.log('SteedosPackageJson=', SteedosPackage);
        var isEmptyPackage = true;
        for(const metadataName in SteedosPackage){
            const metadata = SteedosPackage[metadataName];
            for(const key in metadata){
                if(metadata[key]){
                    isEmptyPackage = false;
                    break;
                }
            }
        }
        if(isEmptyPackage){
            throw new Error('data not found in package');
        }

        //todo 限制要挪到jsonToDb里
        const masterDetailLimit = 2;
        for(const metadataName in SteedosPackage){
            if(metadataName == TypeInfoKeys.Object){
                const objects = SteedosPackage[metadataName];
                for(const objectName in objects){
                    const object = objects[objectName];
                    const fields = object[TypeInfoKeys.Field];
                    let masterDetailCount = 0;

                    // yupeng: 同一个对象中 master_detail 字段的数量不能超过 2 个
                    for(const FieldName in fields){
                        const field = fields[FieldName];
                        if(field['type'] == 'master_detail'){
                            if(++masterDetailCount > masterDetailLimit){
                                throw new Error('Field type [master_detail] over limit in Object: '+objectName +", max:"+ masterDetailLimit);
                            }
                        }
                    }
                }
            }
        }
        
        await dbManager.connect();
        var session = await dbManager.startSession();

        // yupeng: 数据库事务，将 json 对象批量插入到 mongo 数据库中
        await jsonToDb(SteedosPackage, dbManager, session);
        
        resMsg.status = "200";
        resMsg.msg = "deploy success!";
        
    } catch (err) {
        resMsg.status = "500";
        resMsg.msg = err.message;
    }finally{
        await dbManager.endSession();
        await dbManager.close();
    }  

    deleteFolderRecursive(tempDir);
    return res.status(resMsg.status).send(resMsg.msg);
};

router.post('/api/metadata/deploy', requireAuthentication, function (req, res) {
    return Fiber(function(){
        return uploadMetadata(req, res);
    }).run();;
});
exports.default = router;
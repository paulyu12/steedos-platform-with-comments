import { getCollectionNameByMetadata, SteedosMetadataTypeInfoKeys} from '@steedos/metadata-core';
import { workflowsFromDb} from './workflow';
import _ from 'underscore';

export async function getMetadataSources(dbManager, metadataName){

    let filters: any = {is_deleted: {$ne: true}}
    let records;

    switch (metadataName) {
        case 'Workflow':
            let steedosPackage = {};
            await workflowsFromDb(dbManager, ['*'], steedosPackage);
            let recordMap = steedosPackage[SteedosMetadataTypeInfoKeys.Workflow]
            records = []
            for(let recordName in recordMap){
                let record = recordMap[recordName]
                record.name = recordName
                records.push(record);
            }
            return records;
        default:

            // yupeng: metadataName = "CustomObject"
            // yupeng: 这里用 CustomObject 这个参数从 yml 中获取对应的 mongoDB 中的 collection ———— objects 表
            // yml 文件位置：\packages\metadata-core\type_infos\CustomObject.yml
            let collectionName = getCollectionNameByMetadata(metadataName);
            if(!collectionName){
                return [];
            }
            // yupeng: 因为 profile 和 permissionset 都是存储在 permissionset 表中，则需要通过 filter 来过滤
            if(metadataName === SteedosMetadataTypeInfoKeys.Profile){
                filters.type = 'profile';
            }else if(metadataName === SteedosMetadataTypeInfoKeys.Permissionset){
                filters.type = {$ne: 'profile'};
            }
            records = await dbManager.find(collectionName, filters);
            return records;
    }
}
const path = require("path");
import { getFullName } from '@steedos/metadata-core';

export function checkNameEquals(json, name, filepath, metadataName){

    // yupeng：json 里面保存的是 json 格式的完整元数据，getFullName 就是从这段 json 中取出元数据的名字。但是不同类型的元数据取出名字的方式不同。如 Objects 取 name 字段，Permissionset 元数据则取出 permission_set_id 字段作为名字
    var fullName = getFullName(metadataName ,json);

    if(fullName != name){
        throw new Error('The attribute "name" in the file does not match its filename.\nName:"'+json['name']+'" Filename:"'+path.basename(filepath)+'"')
    }
}
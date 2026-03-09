import { getServices } from "../model/serviceModel.js";


export async function getActiveServices(req,res) {
    const services = await getServices()
    return res.json(services);

}
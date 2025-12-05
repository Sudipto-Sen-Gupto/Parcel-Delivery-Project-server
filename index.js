const express=require('express');
const app=express();
const cors=require('cors');
require('dotenv').config()
const port=process.env.port || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET)
// middleware
app.use(cors());
app.use(express.json());


const admin = require("firebase-admin");

const serviceAccount = require("./percel-delivery.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



const verifyFBToken=async(req,res,next)=>{
  //  console.log("headers in the middleware",req.headers.authorization);
   const token=req.headers.authorization;
    //  console.log(token);
    
   if(!token){
    return res.status(401).send({message:'Unauthorized'})
   }

   try{
             const idToken=token.split(' ')[1];
             console.log("token=",idToken);
             const decode= await admin.auth().verifyIdToken(idToken)
             console.log("decoded",decode);
             req.decoded_email=decode.email;
             next();
   }
   catch(err){
              return res.status(401).send({message:'unauthorized'})
   }
     
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6pjurty.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

 function generateTrackingId() {
    const prefix = "TRK";
    const date = new Date().toISOString().slice(0,10).replace(/-/g, ""); // YYYYMMDD
    const random = Math.random().toString(36).substring(2, 8).toUpperCase(); // 6 chars

    return `${prefix}-${date}-${random}`;
}

// Example
console.log(generateTrackingId());

async function run(){
    try{
       await client.connect();
      //  await client.db('admin').command({ping:1})  
       console.log("connect to mongodb");

       const database=client.db('Parcel-delivery-project');
       const dataCollection=database.collection('userData');
       const paymentCollection=database.collection('PaymentData') 
       const userDetailCollection=database.collection("UserDetail") 
       const riderInfoCollection=database.collection('RidersData')
       const trackingCollection=database.collection('TrackingsData')
         

          const logTracking=async(trackingId,status)=>{
                const log= {
                  trackingId,
                  status,
                  detail:status.split('-').join(' '),
                  createdAt: new Date()
                }

                const result=await trackingCollection.insertOne(log);
                return result;
          }

      // parcel api

       app.get('/parcels',async(req,res)=>{
        const query={};
        const option={sort:{createdAt:-1}}
        const {email,deliveryStatus}=req.query;
        if(email){
          query.senderEmail=email;
        }

        if(deliveryStatus){
          query.deliveryStatus=deliveryStatus
        }
        const cursor=dataCollection.find(query,option)
        const result= await cursor.toArray();

        
        res.send(result)
       })
        
       app.post('/parcels',async(req,res)=>{
         
        const trackingId= generateTrackingId();


        const query=req.body;

        query.createdAt=new Date();
        query.trackingId=trackingId;
         
        logTracking(trackingId,'parcel-created')

        const result=await dataCollection.insertOne(query);
        res.send(result)

       })

       app.get('/parcels/rider',async(req,res)=>{
               
           const {email,deliveryStatus}=req.query;

           const query={};

           if(email){
              query.RiderEmail=email;
           }

           if(deliveryStatus !=='parcel_delivered'){
                //  query.deliveryStatus={$in:['Driver_assigned','Delivery On the Way']}

                 query.deliveryStatus={$nin:['parcel_delivered']}
           }

           else{
                query.deliveryStatus=deliveryStatus;
           }

           const cursor= dataCollection.find(query);
           const result=await cursor.toArray();
            

            res.send(result);
       })

       app.patch('/parcels/:id',async(req,res)=>{
              
             const id =req.params.id;
             const query={_id: new ObjectId(id)}
             const{Rider_name,Rider_id,Rider_email,trackingId}=req.body

             const updateData={
              $set:{
                deliveryStatus:'Driver_assigned',
                RiderName:Rider_name,
                RiderId:Rider_id,
                RiderEmail:Rider_email
              }
             }
             const result=await dataCollection.updateOne(query,updateData)

            //  rider update
            const riderQuery={_id:new ObjectId(Rider_id)}
                
             const updateRiderData={
              $set:{
                workStatus:'in_delivery'
              }
             }
             
            const riderResult=await riderInfoCollection.updateOne(riderQuery,updateRiderData)
                
              logTracking(trackingId,'Driver_assigned')
               
            res.send({riderResult,result})
       })


        app.patch('/parcels/:id/status',async(req,res)=>{
                   const id=req.params.id;
                   const query={_id: new ObjectId(id)}
                   const {deliveryStatus,riderId,trackingId}=req.body;

                   const updateStatus={
                    $set:{
                          deliveryStatus: deliveryStatus
                    }
                   }

                   if(deliveryStatus==='parcel_delivered'){
                          
                     const riderQuery={_id:new ObjectId(riderId)}

                       const updateData={
                        $set :{
                              workStatus: 'available'
                        }
                       }

                       const result= await riderInfoCollection.updateOne(riderQuery,updateData);
                      //  res.send(result)
                   }
                   
                   const result=await dataCollection.updateOne(query,updateStatus)

                   //log tracking id
                   logTracking(trackingId,deliveryStatus);
                   res.send(result)

        })

       app.delete('/parcels/:id',async(req,res)=>{
        const query=req.params.id;
        const id={_id: new ObjectId(query)};
        const result=await dataCollection.deleteOne(id);
        res.send(result)
       })


       app.get('/parcels/:id',async(req,res)=>{
        const query=req.params.id;
        const id={_id: new ObjectId(query)};
        const result=await dataCollection.findOne(id);
        // const result=await cursor.toArray(); for find
        res.send(result)
       })

       app.get('/parcel/deliverystatus/state',async(req,res)=>{
             const pipeline=[
              {
                   $group:{
                      //field name of from userdetail in database
                    _id: '$deliveryStatus',
                     count:{$sum:1}
                   }
             },
                 {  
                  $project:{
                    status:'$_id',
                    count:1,
                    // _id:0
                    
                   }
                  }
            
            ]

             const result=await dataCollection.aggregate(pipeline).toArray();
             res.send(result);
       })
           
        app.get('/riders/delivery-per-day',async(req,res)=>{
                 
              const email=req.query.email;

              const pipeline=[
                {
                  $match:{
                    RiderEmail : email
                  }
                }
              ]


              const result=await dataCollection.aggregate(pipeline).toArray();
              res.send(result)
        })

      // direct payment api

      app.post('/create-checkout-direct-session',async(req,res)=>{
        const paymentData=req.body;
        // console.log(paymentData);
        const amount=parseInt(paymentData.cost)*100;
        const session =await stripe.checkout.sessions.create({
    line_items: [
      {
        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
        price_data:{
          currency:'usd',
          unit_amount:amount,
          product_data:{
            name:paymentData.parcelName
          }
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    customer_email:paymentData.senderEmail,
       metadata:{
               parcelId: paymentData.parcelId,
               parcelName:paymentData.parcelName,
               trackingId:paymentData.trackingId
       },
        success_url: `${process.env.SITE_DOMAIN}/adminLayout/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:`${process.env.SITE_DOMAIN}/adminLayout/payment-cancelled`
  });

           console.log(session);
           res.send({url:session.url})
      })

      app.patch('/payment-success',async(req,res)=>{
        const sessionId=req.query.session_id;
        const session=await stripe.checkout.sessions.retrieve(sessionId);

        console.log(session);
         
        // const trackingId=generateTrackingId()

        const trackingId=session.metadata.trackingId

      if(trackingId){
        return res.send({message:'already exist'})
      }

        const transactionId=session.payment_intent
           
       const query={transactionId:transactionId}

       const paymentExist=await paymentCollection.findOne(query);

       if(paymentExist){
        return res.send({message:'already exist',transactionId,trackingId:paymentExist.trackingId})
       }

        // console.log(sessionId);
        if(session.payment_status==='paid'){

          const id=session.metadata.parcelId;

          const query={_id:new ObjectId(id)};
          const update={
            $set:{
                 paymentStatus:'paid',
                 deliveryStatus: 'pending-pickup',
                 trackingId:trackingId

            }
          }

          const result=await dataCollection.updateOne(query,update);

           const payment={
                   amount:session.amount_total/100,
                   currency:session.currency,
                   customerEmail:session.customer_email,
                   parcelId : session.metadata.parcelId,
                   parcelName:session.metadata.parcelName,
                   transactionId:session.payment_intent,     
                  //  payment_intent= transaction id
                  paymentStatus:session.payment_status,
                  paidAt: new Date(),
                  trackingId:trackingId
                 

          }
                 if(session.payment_status==='paid'){
                        
                          logTracking(trackingId,'pending-pickup')
                      
                      const resultPayment=await paymentCollection.insertOne(payment);

                     return  res.send({success:true,modifyParcel:result,paymentInfo:resultPayment,trackingId:trackingId,transactionId:transactionId})
                 }
          
        }
                      return res.send({success:false})
      })
          
     
      app.get('/payment',verifyFBToken,async(req,res)=>{

        //  console.log('header:', req.headers);
        const email=req.query.email
        const query={}

        if(email){
            query.customerEmail=email;

            if(email !==req.decoded_email){
              return res.status(403).send({message:'forbidden'})
            }
        }

        const cursor= paymentCollection.find(query).sort({paidAt:-1});
            const result=await cursor.toArray()
            res.send(result)
      })

       //payment api
  //      app.post('/create-checkout-session',async(req,res)=>{
  //       const paymentInfo=req.body;
  //        console.log("Received paymentInfo:", req.body);
  //       const amount= parseInt(paymentInfo.cost)*100
  //       const session=await stripe.checkout.sessions.create({
  //                  line_items: [
  //     {
  //       // Provide the exact Price ID (for example, price_1234) of the product you want to sell
  //       price_data:{
  //         currency:'USD',
  //         unit_amount:amount,
  //         product_data:{
  //           name:paymentInfo.parcelName
  //         }
  //       },
  //       quantity: 1,
  //     },
  //   ],
  //   mode: 'payment',
  //   metadata:{
  //        parcelId: paymentInfo.parcelId
  //   },
  //   customer_email:paymentInfo.senderEmail,
  //   success_url: `${process.env.SITE_DOMAIN}/adminLayout/payment-success`,
  //   cancel_url: `${process.env.SITE_DOMAIN}/adminLayout/payment-cancelled`
  // });

  //           console.log(session);
  //           res.send({url:session.url})
  //       })
         
        //  user api

        app.post('/userdetail',async(req,res)=>{
             
          const user=req.body;
           user.role='user'
          user.createdAt=new Date();
              
          const email=user.email;
          const userExist= await userDetailCollection.findOne({email})

          if(userExist){
               return res.send({message:"email has already existed"})
              
          }

          const result=await userDetailCollection.insertOne(user);
          res.send(result)
        })
         
             
        app.get('/userdetail',async(req,res)=>{
                  
              const searchText=req.query.searchtext;

             const query ={}

             if(searchText){
                     
              query.displayName={$regex:searchText,$options:'i'}
                  //  query={
                  //   $or:[
                  //     {  displayName:{ $regex:searchText, $options:'i' }},
                  //     {email:{$regex:searchText,$options:'i'}}
                  //   ]
                  //  }
             }
               
                const cursor =userDetailCollection.find(query).sort({createdAt:-1}).limit(5);
                const result=await cursor.toArray();
                res.send(result);
        })

            //  user role

             const verifyAdmin=async(req,res,next)=>{
              
              const email=req.decoded_email;
              const query={email}
              const user=await userDetailCollection.findOne(query)

              if(!user || user.role !=='admin'){
                req.status(403).send({message:"Forbidden"})
              }
        
              next()
       }

            app.get('/userdetail/:id',(req,res)=>{

            })

            app.get('/userdetail/:email/role',async(req,res)=>{
               const email=req.params.email     
              const query={email}

              const result= await userDetailCollection.findOne(query);
              res.send({role: result?.role || 'user'})
            })
            

        app.patch('/userdetail/:id/role',verifyFBToken,verifyAdmin,async(req,res)=>{
                 
               const id=req.params.id
               const userInfo=req.body
               const query={_id: new ObjectId(id)};

            const   updateInfo={
                $set:{
                  role: userInfo.role
                }
               }
               const result=await  userDetailCollection.updateOne(query,updateInfo);
               res.send(result);
        })
        // rider api

        app.post('/riders',async(req,res)=>{

          const riderDetail=req.body;

         riderDetail.status='Pending',
         riderDetail.createdAt= new Date();

             const result= await riderInfoCollection.insertOne(riderDetail);
             res.send(result);
        })


        app.get('/riders', async(req,res)=>{
            
           const {status,district,workStatus}=req.query

          const query={}
          if(status){
            query.status=status
          }
            if(district){
              query.riderDistrict=district
            }

            if(workStatus){
              query.workStatus=workStatus
            }
          const cursor= riderInfoCollection.find(query);
          const result=await cursor.toArray();
          res.send(result)
        })


        app.patch('/riders/:id',verifyFBToken,async(req,res)=>{
           const id=req.params.id 
           const query={_id: new ObjectId(id)}
           const status=req.body.status
           const updateRiders={
            $set:{
              status:status,
              workStatus:'available'
            }
           }
           const result=await riderInfoCollection.updateOne(query,updateRiders)

           if(status==='Approved'){
                 const email=req.body.email;
                 
                 
                
                  userQuery={email:email}
                 
                  updateData={
                    $set:{
                            // role:'Rider',
                            //    workStatus:'available'
                    }
                  }
                  const userResult=await riderInfoCollection.updateOne(query,updateData)
           }
           res.send(result)
        })


        // tracking api

        app.get('/tracking/:trackingId/log',async(req,res)=>{
             
              const trackingId=req.params.trackingId;
              const query={trackingId};

              const result =await trackingCollection.find(query).toArray();
                  
             
              res.send(result);
        })
    }
         
    finally{

    }
}

run().catch(console.dir)

app.get('/',(req,res)=>{
    res.send('Welcome to parcel delivery website')
})

app.listen(port,()=>{
    console.log('PORT moves to',port);
})